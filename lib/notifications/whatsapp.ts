import { connectDB } from "@/lib/db";
import { markPostPaymentThankYou } from "@/lib/services/sessionService";
import { logger } from "@/lib/utils/logger";
import { normalizePhone } from "@/lib/utils/phone";
import { formatOrderPlacedMessage } from "@/lib/whatsapp/orderPaidCopy";
import { sendMessage } from "@/lib/whatsapp/sendMessage";
import { OrderModel } from "@/models/Order";
import { UserModel } from "@/models/User";

function getInventoryRecipients(excludeCustomerPhone?: string) {
  const exclude = excludeCustomerPhone?.trim() ? normalizePhone(excludeCustomerPhone) : "";
  return (process.env.WHATSAPP_INVENTORY_ALERT_RECIPIENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((recipient) => !exclude || normalizePhone(recipient) !== exclude);
}

function buildInventoryAlertMessage(order: {
  orderId: string;
  totalAmount: number;
  items: Array<{ name: string; quantity: number }>;
  address?: { line1?: string; city?: string; state?: string; postalCode?: string };
}) {
  const itemLines = order.items.map((item) => `- ${item.name} x ${item.quantity}`).join("\n");
  const addressLine = [order.address?.line1, order.address?.city, order.address?.state, order.address?.postalCode]
    .filter(Boolean)
    .join(", ");

  return `*New PAID Order* ✅\nOrder ID: ${order.orderId}\nAmount: INR ${order.totalAmount.toFixed(
    2,
  )}\n\n*Items*\n${itemLines || "- (no items)"}\n\n*Delivery Address*\n${addressLine || "Not provided"}`;
}

async function notifyInventoryTeam(
  order: {
    orderId: string;
    totalAmount: number;
    items: Array<{ name: string; quantity: number }>;
    address?: { line1?: string; city?: string; state?: string; postalCode?: string };
  },
  excludeCustomerPhone?: string,
) {
  const recipients = getInventoryRecipients(excludeCustomerPhone);
  if (!recipients.length) return;

  const message = buildInventoryAlertMessage(order);
  const results = await Promise.allSettled(recipients.map((phone) => sendMessage(phone, message)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn("whatsapp.inventory", "ops notify send failed (non-fatal)", {
        orderId: order.orderId,
        target: `recipient:${recipients[index]}`,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
}

/**
 * After Razorpay webhook marks the order paid: notify customer on WhatsApp (plain text, no template env).
 *
 * Ops / kitchen alerts:
 * - `WHATSAPP_INVENTORY_ALERT_RECIPIENTS` — comma-separated WhatsApp numbers (1:1).
 */
export async function sendOrderPaidWhatsAppConfirmation(orderId: string) {
  await connectDB();

  const order = await OrderModel.findOne({ businessOrderId: orderId }).lean();
  if (!order) return;

  const user = await UserModel.findOne({ userId: order.userId }).lean();
  const phone = user?.phone?.trim();

  const addressForMessage = { line1: order.address?.trim() || undefined };

  const inventoryAlertPromise = notifyInventoryTeam(
    {
      orderId: order.businessOrderId ?? orderId,
      totalAmount: order.orderValue,
      items: order.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
      address: addressForMessage,
    },
    phone,
  );

  if (!phone) {
    await inventoryAlertPromise;
    return;
  }

  await sendMessage(
    phone,
    formatOrderPlacedMessage({
      orderId: order.businessOrderId ?? orderId,
      totalAmount: order.orderValue,
      customerName: user?.name,
      items: order.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
      address: addressForMessage,
    }),
  );
  await inventoryAlertPromise;
  logger.info("whatsapp.order_paid", "order placed message sent", { orderId });

  try {
    await markPostPaymentThankYou(phone);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "unknown";
    logger.warn("whatsapp.order_paid", "markPostPaymentThankYou failed (non-fatal)", { orderId, error: messageText });
  }
}
