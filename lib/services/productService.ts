import { connectDB } from "@/lib/db";
import { ProductModel } from "@/models/Product";

export async function getAllActiveProducts() {
  await connectDB();

  return ProductModel.find({ isActive: true, stock: { $gt: 0 } })
    .sort({ name: 1 })
    .lean();
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

