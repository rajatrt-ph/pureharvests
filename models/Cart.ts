import mongoose, { type InferSchemaType } from "mongoose";

const CartItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const CartSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true, trim: true },
    items: { type: [CartItemSchema], default: [] },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

export type Cart = InferSchemaType<typeof CartSchema>;

export const CartModel =
  (mongoose.models.Cart as mongoose.Model<Cart>) || mongoose.model<Cart>("Cart", CartSchema);

