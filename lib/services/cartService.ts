import { connectDB } from "@/lib/db";
import { CartModel, type Cart } from "@/models/Cart";

type CartProductInput = {
  productId: string;
  name: string;
  price: number;
};

type CartLike = {
  items: Array<{ price: number; quantity: number }>;
};

export function calculateTotal(cart: CartLike) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export async function getOrCreateCart(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  await connectDB();

  let cart = await CartModel.findOne({ userId: normalizedUserId });
  if (!cart) {
    cart = await CartModel.create({
      userId: normalizedUserId,
      items: [],
      totalAmount: 0,
    });
  }

  return cart;
}

export async function addItemToCart(
  userId: string,
  product: CartProductInput,
  quantity: number,
) {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10) {
    throw new Error("quantity must be an integer between 1 and 10");
  }

  const cart = await getOrCreateCart(userId);

  const existingItem = cart.items.find((item) => item.productId === product.productId);
  if (existingItem) {
    existingItem.quantity += quantity;
    existingItem.price = product.price;
    existingItem.name = product.name;
  } else {
    cart.items.push({
      productId: product.productId,
      name: product.name,
      price: product.price,
      quantity,
    } as Cart["items"][number]);
  }

  cart.totalAmount = calculateTotal(cart);
  await cart.save();
  return cart;
}

export async function clearCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  cart.items.splice(0, cart.items.length);
  cart.totalAmount = 0;
  await cart.save();
  return cart;
}

/** Removes cart document(s) for this user. Prefer after checkout / paid so the collection does not keep empty carts. Idempotent. */
export async function deleteCart(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  await connectDB();
  const result = await CartModel.deleteMany({ userId: normalizedUserId });
  return { deletedCount: result.deletedCount };
}

