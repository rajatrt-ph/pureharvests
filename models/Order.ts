import mongoose, { type InferSchemaType } from "mongoose";

const OrderItemSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const OrderSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },

    items: { type: [OrderItemSchema], required: true, default: [] },
    orderValue: { type: Number, required: true, min: 0 },

    paymentStatus: {
      type: String,
      required: true,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    orderStatus: {
      type: String,
      required: true,
      enum: ["pending", "confirmed", "ready_to_ship", "shipped", "delivered", "cancelled"],
      default: "pending",
    },

    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

export type Order = InferSchemaType<typeof OrderSchema>;

export const OrderModel =
  (mongoose.models.Order as mongoose.Model<Order>) || mongoose.model<Order>("Order", OrderSchema);

