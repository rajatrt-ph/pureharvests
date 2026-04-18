import mongoose, { type InferSchemaType } from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true, trim: true },
    razorpayPaymentId: { type: String, trim: true, default: "" },
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

