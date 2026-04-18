import { connectDB } from "@/lib/db";
import { SessionModel } from "@/models/Session";
import { isValidPhone, normalizePhone } from "@/lib/utils/phone";

type SessionFlow = "order" | "track" | null;

export type SessionUpdates = {
  currentFlow?: SessionFlow;
  step?: string;
  cartId?: string;
  tempData?: Record<string, unknown>;
};

export async function createSession(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    throw new Error("Invalid phone number");
  }

  await connectDB();

  const existing = await SessionModel.findOne({ phone: normalizedPhone });
  if (existing) return existing;

  return SessionModel.create({
    phone: normalizedPhone,
    currentFlow: null,
    step: "",
    cartId: "",
    tempData: {},
  });
}

export async function getSession(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    throw new Error("Invalid phone number");
  }

  await connectDB();

  let session = await SessionModel.findOne({ phone: normalizedPhone });
  if (!session) {
    session = await createSession(normalizedPhone);
  }

  return session;
}

export async function updateSession(phone: string, updates: SessionUpdates) {
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    throw new Error("Invalid phone number");
  }

  const session = await getSession(normalizedPhone);

  if (updates.currentFlow !== undefined) {
    session.currentFlow = updates.currentFlow;
  }
  if (updates.step !== undefined) {
    session.step = updates.step;
  }
  if (updates.cartId !== undefined) {
    session.cartId = updates.cartId;
  }
  if (updates.tempData !== undefined) {
    session.tempData = updates.tempData;
  }

  await session.save();
  return session;
}

export async function resetSession(phone: string) {
  const session = await getSession(phone);
  session.currentFlow = null;
  session.step = "";
  session.cartId = "";
  session.tempData = {};
  await session.save();
  return session;
}

/** After Razorpay marks the order paid: next user message should close with thanks (not the product list). */
export async function markPostPaymentThankYou(phone: string) {
  await updateSession(phone, { currentFlow: null, step: "post_payment_thanks", tempData: {} });
}

