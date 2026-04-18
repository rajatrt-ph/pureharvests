import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Add it to .env.local first.");
}

/** Mirror of `lib/utils/productId.ts` `slugifyProductId` — keep algorithms identical. */
function slugifyProductId(name) {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return s || "product";
}

const ProductSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, collection: "products" },
);

const Product = mongoose.models.Product || mongoose.model("Product", ProductSchema);

const PRODUCT_INPUTS = [
  {
    name: "Mustard Oil 200ml",
    description: "Cold-pressed mustard oil pack.",
    price: 49,
    stock: 100,
    isActive: true,
  },
  {
    name: "Mustard Oil 1L",
    description: "Cold-pressed mustard oil bottle.",
    price: 290,
    stock: 100,
    isActive: true,
  },
];

const PRODUCTS_TO_UPSERT = PRODUCT_INPUTS.map((p) => ({
  ...p,
  productId: slugifyProductId(p.name),
}));

async function main() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });

  for (const product of PRODUCTS_TO_UPSERT) {
    await Product.updateOne(
      { productId: product.productId },
      { $set: product },
      { upsert: true },
    );
  }

  console.log(`Upserted ${PRODUCTS_TO_UPSERT.length} products into products collection.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Failed to seed products:", error);
  await mongoose.disconnect();
  process.exit(1);
});
