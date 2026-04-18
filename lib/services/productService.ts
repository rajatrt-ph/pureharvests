import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { ProductModel } from "@/models/Product";
import { slugifyProductId } from "@/lib/utils/productId";

export async function getAllActiveProducts() {
  await connectDB();

  return ProductModel.find({ isActive: true, stock: { $gt: 0 } })
    .sort({ name: 1 })
    .lean();
}

/** Current stock for cart / quantity limits (same catalog id as cart line items). */
export async function getActiveProductByProductId(productId: string) {
  const id = productId.trim();
  if (!id) return null;

  await connectDB();
  return ProductModel.findOne({ productId: id, isActive: true }).select("productId name price stock").lean();
}

function formatPriceINR(value: number) {
  return `₹${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

export function formatProductList(
  products: Array<{ name: string; price: number }> = [],
) {
  if (products.length === 0) {
    return "No products available right now.";
  }

  return products.map((product, index) => `${index + 1}. ${product.name} - ${formatPriceINR(product.price)}`).join("\n");
}

export async function listAllProductsAdmin() {
  await connectDB();
  return ProductModel.find({}).sort({ name: 1 }).lean();
}

async function allocateUniqueProductId(name: string): Promise<string> {
  await connectDB();
  const base = slugifyProductId(name);
  for (let n = 0; n < 10_000; n++) {
    const candidate = n === 0 ? base : `${base}-${n}`;
    const exists = await ProductModel.exists({ productId: candidate });
    if (!exists) return candidate;
  }
  throw new Error("Could not allocate a unique productId");
}

export async function getProductByMongoIdForAdmin(id: string) {
  const trimmed = id.trim();
  if (!trimmed || !mongoose.Types.ObjectId.isValid(trimmed)) return null;
  await connectDB();
  return ProductModel.findById(trimmed).lean();
}

export async function createProductForAdmin(input: {
  name: string;
  description?: string;
  price: number;
  stock: number;
  isActive?: boolean;
}) {
  const productId = await allocateUniqueProductId(input.name);
  await connectDB();
  const created = await ProductModel.create({
    productId,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    price: input.price,
    stock: input.stock,
    isActive: input.isActive ?? true,
  });
  return created.toObject();
}

export async function updateProductByMongoIdForAdmin(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    price: number;
    stock: number;
    isActive: boolean;
  }>,
) {
  const trimmed = id.trim();
  if (!trimmed || !mongoose.Types.ObjectId.isValid(trimmed)) return null;

  await connectDB();
  const doc = await ProductModel.findById(trimmed);
  if (!doc) return null;

  if (typeof patch.name === "string") doc.name = patch.name.trim();
  if (typeof patch.description === "string") doc.description = patch.description.trim();
  if (typeof patch.price === "number") doc.price = patch.price;
  if (typeof patch.stock === "number") doc.stock = patch.stock;
  if (typeof patch.isActive === "boolean") doc.isActive = patch.isActive;

  const saved = await doc.save();
  return saved.toObject();
}

