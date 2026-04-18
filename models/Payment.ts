import mongoose, { type InferSchemaType } from "mongoose";

/**
 * One document per checkout order (`orderId` = business id, e.g. ORD…).
 * Initial checkout and every “Pay again / Retry” create a new Razorpay payment link, but we
 * **update** this row (same `orderId`) — we do not keep a separate DB row per attempt.
 * Latest link id and payment id are what Razorpay webhooks reconcile against `reference_id`.
 */
const PaymentSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true, trim: true },
    razorpayPaymentId: { type: String, trim: true, default: "" },
    /** Last Razorpay *payment link* id from `payment_links` API / webhook (name is historical). */
    razorpayOrderId: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

export type Payment = InferSchemaType<typeof PaymentSchema>;

export const PaymentModel =
  (mongoose.models.Payment as mongoose.Model<Payment>) ||
  mongoose.model<Payment>("Payment", PaymentSchema);

