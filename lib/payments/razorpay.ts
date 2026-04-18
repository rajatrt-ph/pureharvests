import { connectDB } from "@/lib/db";
import { PaymentModel } from "@/models/Payment";

/** Razorpay `POST /v1/payment_links` returns `short_url` at root; tolerate minor shape differences. */
export function extractPaymentLinkShortUrl(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const d = data as Record<string, unknown>;
  const pick = (x: unknown) => (typeof x === "string" && /^https?:\/\//i.test(x) ? x : "");
  const root = pick(d.short_url) || pick(d.url);
  if (root) return root;
  const entity = d.entity;
  if (entity && typeof entity === "object") {
    const e = entity as Record<string, unknown>;
    return pick(e.short_url) || pick(e.url);
  }
  return "";
}

type CreatePaymentLinkInput = {
  orderId: string;
  userId: string;
  totalAmount: number;
  phone?: string;
  name?: string;
  description?: string;
};

function getRazorpayEnv() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Missing Razorpay env vars: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET");
  }

  return { keyId, keySecret };
}

export async function createPaymentLink(order: CreatePaymentLinkInput) {
  if (!order.orderId.trim()) throw new Error("orderId is required");
  if (!order.userId.trim()) throw new Error("userId is required");
  if (!Number.isFinite(order.totalAmount) || order.totalAmount <= 0) {
    throw new Error("totalAmount must be greater than 0");
  }

  const { keyId, keySecret } = getRazorpayEnv();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const body = {
    amount: Math.round(order.totalAmount * 100),
    currency: "INR",
    accept_partial: false,
    reference_id: order.orderId,
    description: order.description ?? `Payment for order ${order.orderId}`,
    customer: {
      name: order.name ?? "",
      contact: order.phone ?? "",
    },
    notify: {
      sms: true,
      email: false,
    },
    reminder_enable: true,
    notes: {
      orderId: order.orderId,
      userId: order.userId,
    },
  };

  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const message = typeof data.error === "object" ? JSON.stringify(data.error) : res.statusText;
    throw new Error(`Razorpay payment link failed: ${message}`);
  }

  const payUrl = extractPaymentLinkShortUrl(data);
  if (!payUrl) {
    throw new Error(
      `Razorpay payment link response missing short_url (id=${String(data.id ?? "")}). Check API keys and account mode.`,
    );
  }

  await connectDB();
  // Same row as first checkout: one Payment per `orderId`, overwrite link id when user pays again from Track.
  await PaymentModel.findOneAndUpdate(
    { orderId: order.orderId },
    {
      orderId: order.orderId,
      amount: order.totalAmount,
      razorpayOrderId: String(data.id ?? ""),
      status: "pending",
    },
    { upsert: true, new: true, runValidators: true },
  );

  return { ...data, short_url: payUrl };
}

