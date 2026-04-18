import crypto from "node:crypto";

/**
 * Razorpay signs the raw JSON body with HMAC-SHA256 using the webhook secret from the dashboard.
 * The digest is compared to `X-Razorpay-Signature` (hex string).
 *
 * @see https://razorpay.com/docs/webhooks/validate-test/
 */
export function verifyRazorpayWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.trim() || !secret) return false;

  const received = signatureHeader.trim();
  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  if (received.length !== expectedHex.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expectedHex, "utf8"));
  } catch {
    return false;
  }
}

type Loose = Record<string, unknown>;

function asRecord(v: unknown): Loose | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : null;
}

export type RazorpayWebhookPaymentContext = {
  /** Our business order id (ORD…) — never the Razorpay payment link id. */
  orderId: string;
  razorpayEvent: string;
  razorpayPaymentId: string;
  razorpayPaymentLinkId: string;
  amountRupees: number;
  rawStatus: string;
};

/**
 * Extracts order + payment fields from heterogeneous Razorpay webhook payloads.
 * Supports payment link flows (`reference_id`) and payment-only events (`notes.orderId`).
 */
export function extractPaymentContextFromWebhookPayload(payload: Loose): RazorpayWebhookPaymentContext | null {
  const razorpayEvent = typeof payload.event === "string" ? payload.event : "";

  const root = asRecord(payload.payload);
  const plWrap = asRecord(root?.payment_link);
  const plEntity = asRecord(plWrap?.entity);
  const payWrap = asRecord(root?.payment);
  const payEntity = asRecord(payWrap?.entity);

  const referenceId = typeof plEntity?.reference_id === "string" ? plEntity.reference_id.trim() : "";
  /** Payment link `notes` from create API (always set our `orderId` = business ORD…). Prefer over `reference_id` when we use unique refs per link (retries). */
  const plNotes = asRecord(plEntity?.notes);
  const orderFromPlLinkNotes =
    (typeof plNotes?.orderId === "string" && plNotes.orderId.trim()) ||
    (typeof plNotes?.order_id === "string" && plNotes.order_id.trim()) ||
    "";
  const payNotes = asRecord(payEntity?.notes);
  const orderFromPaymentNotes =
    (typeof payNotes?.orderId === "string" && payNotes.orderId.trim()) ||
    (typeof payNotes?.order_id === "string" && payNotes.order_id.trim()) ||
    "";

  const orderId = orderFromPlLinkNotes || orderFromPaymentNotes || referenceId;
  if (!orderId) return null;

  const razorpayPaymentLinkId = typeof plEntity?.id === "string" ? plEntity.id : "";
  const razorpayPaymentId = typeof payEntity?.id === "string" ? payEntity.id : "";

  const amountPaise =
    (typeof plEntity?.amount === "number" ? plEntity.amount : undefined) ??
    (typeof payEntity?.amount === "number" ? payEntity.amount : 0);

  const rawStatus =
    (typeof payEntity?.status === "string" ? payEntity.status : "") ||
    (typeof plEntity?.status === "string" ? plEntity.status : "");

  return {
    orderId,
    razorpayEvent,
    razorpayPaymentId,
    razorpayPaymentLinkId,
    amountRupees: Number.isFinite(amountPaise) ? amountPaise / 100 : 0,
    rawStatus,
  };
}

export function mapRazorpayStatusToInternal(status: string | undefined) {
  const s = status?.toLowerCase() ?? "";
  if (s === "paid" || s === "captured") return "success" as const;
  if (s === "failed") return "failed" as const;
  return "pending" as const;
}

/** Events we care about for payment links + standard payments (extend as needed). */
export function shouldProcessWebhookEvent(event: string): boolean {
  if (!event) return true;
  const e = event.toLowerCase();
  if (e.startsWith("payment_link.")) return true;
  if (e.startsWith("payment.")) return true;
  return false;
}
