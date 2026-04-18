import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import { sendOrderPaidWhatsAppConfirmation } from "@/lib/notifications/whatsapp";
import { deleteCart } from "@/lib/services/cartService";
import { applyStockDeductionForPaidOrder } from "@/lib/services/inventoryService";
import {
  extractPaymentContextFromWebhookPayload,
  mapRazorpayStatusToInternal,
  verifyRazorpayWebhookSignature,
} from "@/lib/payments/razorpayWebhook";
import { logger } from "@/lib/utils/logger";
import { OrderModel } from "@/models/Order";
import { PaymentModel } from "@/models/Payment";

/** Webhooks must run on Node (crypto). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveWebhookSecret(): string | null {
  const dedicated = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (dedicated) return dedicated;

  const fallback = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (fallback && process.env.NODE_ENV === "production") {
    logger.warn(
      "razorpay.webhook",
      "RAZORPAY_WEBHOOK_SECRET is not set; using RAZORPAY_KEY_SECRET as HMAC secret — this usually FAILS verification (Razorpay signs with the Webhooks dashboard secret, not the API key). Set RAZORPAY_WEBHOOK_SECRET to the secret shown for this webhook URL in Razorpay → Developers → Webhooks.",
    );
  }
  return fallback ?? null;
}

/** Razorpay sends `X-Razorpay-Signature`; match case-insensitively (some proxies alter casing). */
function getRazorpaySignatureHeader(req: Request): string | null {
  const direct = req.headers.get("x-razorpay-signature")?.trim();
  if (direct) return direct;
  for (const [key, value] of req.headers) {
    if (key.toLowerCase() === "x-razorpay-signature" && value?.trim()) {
      return value.trim();
    }
  }
  return null;
}

/** Uptime / manual checks (Razorpay only POSTs). */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "razorpay-webhook",
    hint: "Configure POST from Razorpay Dashboard with the same URL; set RAZORPAY_WEBHOOK_SECRET.",
  });
}

/**
 * Razorpay → your server when payment link / payment state changes.
 *
 * Env:
 * - `RAZORPAY_WEBHOOK_SECRET` — secret from Dashboard → Webhooks (required for production).
 * - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — API keys (used only as legacy signature fallback).
 *
 * Dashboard: subscribe at least to `payment_link.paid` and `payment.captured` (and optionally `payment.failed`).
 */
export async function POST(req: Request) {
  const webhookSecret = resolveWebhookSecret();
  if (!webhookSecret) {
    logger.error("razorpay.webhook", "missing webhook secret configuration");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const signature = getRazorpaySignatureHeader(req);
  if (!signature) {
    logger.warn("razorpay.webhook", "missing X-Razorpay-Signature header", {
      hint: "Razorpay always sends this on POST; if you see this on Vercel, check for a proxy stripping headers.",
    });
    return NextResponse.json(
      { error: "Missing Razorpay signature", code: "MISSING_SIGNATURE" },
      { status: 400 },
    );
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("razorpay.webhook", "failed to read body", { error: message });
    return NextResponse.json({ error: "Bad request", code: "BODY_READ_FAILED" }, { status: 400 });
  }

  if (!verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)) {
    logger.warn("razorpay.webhook", "invalid signature — check RAZORPAY_WEBHOOK_SECRET matches Razorpay → Webhooks → this URL’s secret (not the API key secret)", {
      usingDedicatedWebhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim()),
    });
    return NextResponse.json(
      { error: "Invalid Razorpay signature", code: "INVALID_SIGNATURE" },
      { status: 401 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn("razorpay.webhook", "invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const context = extractPaymentContextFromWebhookPayload(payload);
  if (!context) {
    logger.info("razorpay.webhook", "skipped — could not resolve order id", {
      event: typeof payload.event === "string" ? payload.event : "",
    });
    return NextResponse.json({ ok: true, skipped: true, reason: "no_order_id" });
  }

  const { orderId, razorpayEvent, razorpayPaymentId, razorpayPaymentLinkId, amountRupees, rawStatus } = context;
  const paymentStatus = mapRazorpayStatusToInternal(rawStatus);

  logger.info("razorpay.webhook", "received", {
    orderId,
    event: razorpayEvent,
    paymentStatus,
    rawStatus,
  });

  try {
    await connectDB();

    let amountToStore = amountRupees;
    if (!(amountToStore > 0)) {
      const existingOrder = await OrderModel.findOne({ businessOrderId: orderId }).select("orderValue").lean();
      amountToStore = existingOrder?.orderValue ?? 0;
    }

    await PaymentModel.findOneAndUpdate(
      { orderId },
      {
        orderId,
        razorpayPaymentId,
        ...(razorpayPaymentLinkId ? { razorpayOrderId: razorpayPaymentLinkId } : {}),
        amount: amountToStore,
        status: paymentStatus,
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );

    if (paymentStatus === "success") {
      /*
       * 1. Payment collection — upserted above.
       * 2. Order — first transition to paid (atomic) + cart cleanup + customer notify.
       *
       * Mongoose 9 rejects pipeline arrays unless `updatePipeline: true`; use plain $set instead.
       */
      let becamePaid = await OrderModel.findOneAndUpdate(
        {
          businessOrderId: orderId,
          paymentStatus: { $ne: "paid" },
          orderStatus: "pending",
        },
        { $set: { paymentStatus: "paid", orderStatus: "confirmed" } },
        { returnDocument: "after" },
      );

      if (!becamePaid) {
        becamePaid = await OrderModel.findOneAndUpdate(
          {
            businessOrderId: orderId,
            paymentStatus: { $ne: "paid" },
            orderStatus: { $ne: "pending" },
          },
          { $set: { paymentStatus: "paid" } },
          { returnDocument: "after" },
        );
      }

      if (becamePaid) {
        await applyStockDeductionForPaidOrder(orderId);

        try {
          await deleteCart(becamePaid.userId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          logger.warn("razorpay.webhook", "deleteCart after payment failed (non-fatal)", { orderId, message });
        }

        await sendOrderPaidWhatsAppConfirmation(orderId);
        logger.info("razorpay.webhook", "order marked paid, stock updated, cart cleared, customer notified", {
          orderId,
        });
      } else {
        logger.info("razorpay.webhook", "order already paid — skipping duplicate notification", { orderId });
        const existing = await OrderModel.findOne({ businessOrderId: orderId }).select("userId").lean();
        if (existing?.userId) {
          try {
            await deleteCart(existing.userId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown";
            logger.warn("razorpay.webhook", "deleteCart on duplicate payment event failed (non-fatal)", {
              orderId,
              message,
            });
          }
        }
      }
    } else if (paymentStatus === "failed") {
      await OrderModel.findOneAndUpdate({ businessOrderId: orderId }, { paymentStatus: "failed" });
      logger.info("razorpay.webhook", "order payment failed", { orderId });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failed";
    logger.error("razorpay.webhook", "handler error", { error: message, orderId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
