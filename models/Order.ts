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
    /** Same as WhatsApp checkout order id (e.g. ORD…), for linking Payment + admin UI. */
    businessOrderId: { type: String, trim: true, sparse: true, unique: true, index: true },
    userId: { type: String, trim: true, default: "" },
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
      enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
      default: "pending",
    },

    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

export type Order = InferSchemaType<typeof OrderSchema>;

export const OrderModel =
  (mongoose.models.Order as mongoose.Model<Order>) || mongoose.model<Order>("Order", OrderSchema);

