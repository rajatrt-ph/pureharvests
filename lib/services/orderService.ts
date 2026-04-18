import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { deleteCart, getOrCreateCart } from "@/lib/services/cartService";
import type { GeoCoordinates } from "@/lib/types/geo";
import { OrderModel } from "@/models/Order";
import { UserModel } from "@/models/User";

export type OrderAddressInput = {
  line1: string;
  line2?: string;
  /** Present when the user shared a map pin; coordinates are not duplicated in line2. */
  geolocation?: GeoCoordinates;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
};

function generateOrderId() {
  const suffix = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `ORD${Date.now()}${suffix}`;
}

function formatAddressForOrderLine(address: OrderAddressInput) {
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country ?? "India",
  ].filter((p) => typeof p === "string" && p.trim().length > 0);
  const line = parts.join(", ");
  if (address.geolocation) {
    const { latitude, longitude } = address.geolocation;
    return `${line}\nLocation: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  }
  return line;
}

export async function createOrderFromCart(userId: string, address: OrderAddressInput) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  await connectDB();
  const cart = await getOrCreateCart(normalizedUserId);

  if (cart.items.length === 0) {
    throw new Error("Cannot create order from empty cart");
  }

  const orderId = generateOrderId();

  const userDoc = await UserModel.findOne({ userId: normalizedUserId }).lean();
  const customerName = userDoc?.name?.trim() || "Customer";
  const phoneNumber = userDoc?.phone?.trim() ?? "";

  await OrderModel.create({
    businessOrderId: orderId,
    userId: normalizedUserId,
    customerName,
    phoneNumber,
    address: formatAddressForOrderLine(address),
    items: cart.items.map((item) => ({
      productId: item.productId,
      productName: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
    orderValue: cart.totalAmount,
    paymentStatus: "pending",
    orderStatus: "pending",
    notes: "",
  });

  await deleteCart(normalizedUserId);
  return {
    orderId,
    userId: normalizedUserId,
    totalAmount: cart.totalAmount,
  };
}

const MAX_TRACK_ORDERS = 10;

export async function listOrdersForUserTrack(userId: string) {
  const uid = userId.trim();
  if (!uid) {
    throw new Error("userId is required");
  }

  await connectDB();
  return OrderModel.find({ userId: uid })
    .sort({ createdAt: -1 })
    .limit(MAX_TRACK_ORDERS)
    .lean();
}

/** `selectionId` is list row id: `businessOrderId` (e.g. ORD…) or Mongo `_id` hex. */
export async function getOrderForUserTrack(selectionId: string, userId: string) {
  const sel = selectionId.trim();
  const uid = userId.trim();
  if (!sel || !uid) {
    return null;
  }

  await connectDB();
  const byBusiness = await OrderModel.findOne({ businessOrderId: sel, userId: uid }).lean();
  if (byBusiness) {
    return byBusiness;
  }
  if (mongoose.Types.ObjectId.isValid(sel)) {
    return OrderModel.findOne({
      _id: new mongoose.Types.ObjectId(sel),
      userId: uid,
    }).lean();
  }
  return null;
}

export async function getAdminOrderByBusinessId(businessOrderId: string) {
  const id = businessOrderId.trim();
  if (!id) return null;
  await connectDB();
  return OrderModel.findOne({ businessOrderId: id }).lean();
}

