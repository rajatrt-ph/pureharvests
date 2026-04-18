import { randomUUID } from "node:crypto";

import { connectDB } from "@/lib/db";
import type { GeoCoordinates } from "@/lib/types/geo";
import { UserModel, type User } from "@/models/User";
import { isValidPhone, normalizePhone } from "@/lib/utils/phone";

export type UserAddressInput = {
  label?: string;
  line1: string;
  line2?: string;
  geolocation?: GeoCoordinates;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
};

export async function getUserByPhone(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    throw new Error("Invalid phone number");
  }

  await connectDB();
  return UserModel.findOne({ phone: normalizedPhone });
}

export async function findOrCreateUser(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    throw new Error("Invalid phone number");
  }

  await connectDB();

  const existingUser = await UserModel.findOne({ phone: normalizedPhone });
  if (existingUser) return existingUser;

  return UserModel.create({
    userId: randomUUID(),
    phone: normalizedPhone,
    status: "pending",
  });
}

export async function updateUserName(userId: string, name: string) {
  const trimmedUserId = userId.trim();
  const trimmedName = name.trim();

  if (!trimmedUserId) {
    throw new Error("userId is required");
  }
  if (!trimmedName) {
    throw new Error("name is required");
  }

  await connectDB();

  return UserModel.findOneAndUpdate(
    { userId: trimmedUserId },
    { name: trimmedName },
    { new: true, runValidators: true },
  );
}

export async function updateUserAddress(userId: string, address: UserAddressInput) {
  if (!userId.trim()) {
    throw new Error("userId is required");
  }

  await connectDB();

  return UserModel.findOneAndUpdate(
    { userId: userId.trim() },
    { $push: { addresses: address } },
    { new: true, runValidators: true },
  );
}

export async function updateUserAddressAtIndex(
  userId: string,
  index: number,
  address: UserAddressInput,
) {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    throw new Error("userId is required");
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("index must be a non-negative integer");
  }

  await connectDB();

  const user = await UserModel.findOne({ userId: trimmedUserId });
  if (!user) {
    throw new Error("User not found");
  }
  if (!Array.isArray(user.addresses) || index >= user.addresses.length) {
    throw new Error("Address index out of range");
  }

  const path = `addresses.${index}`;
  return UserModel.findOneAndUpdate(
    { userId: trimmedUserId },
    { $set: { [path]: address } },
    { new: true, runValidators: true },
  );
}

export type UserDocument = User;

