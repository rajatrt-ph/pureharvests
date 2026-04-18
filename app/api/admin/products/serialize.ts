/** Normalize Mongo lean / document shapes for JSON clients. */
export function toClientProduct(p: {
  _id: { toString(): string };
  productId: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  isActive: boolean;
}) {
  return {
    _id: p._id.toString(),
    productId: p.productId,
    name: p.name,
    description: typeof p.description === "string" ? p.description : "",
    price: p.price,
    stock: p.stock,
    isActive: p.isActive,
  };
}
