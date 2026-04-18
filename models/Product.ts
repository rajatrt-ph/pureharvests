import mongoose, { type InferSchemaType } from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    /** Stable slug (e.g. mustard-oil-1l); set on create, not random UUIDs. */
    productId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

export type Product = InferSchemaType<typeof ProductSchema>;

export const ProductModel =
  (mongoose.models.Product as mongoose.Model<Product>) ||
  mongoose.model<Product>("Product", ProductSchema);

