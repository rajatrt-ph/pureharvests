/**
 * Plain-text WhatsApp message after payment is confirmed (Razorpay webhook).
 * No WhatsApp template env vars — always sent as a normal text message.
 */
export function formatOrderPlacedMessage(order: {
  orderId: string;
  totalAmount: number;
  customerName?: string;
  items: Array<{ name: string; quantity: number }>;
  address?: { line1?: string; city?: string; state?: string; postalCode?: string };
}): string {
  const amount = `₹${new Intl.NumberFormat("en-IN").format(order.totalAmount)}`;
  const name = order.customerName?.trim() || "there";

  const itemLines = order.items.map((item) => `• ${item.name} × ${item.quantity}`).join("\n");
  const addressLine = [order.address?.line1, order.address?.city, order.address?.state, order.address?.postalCode]
    .filter(Boolean)
    .join(", ");

  return [
    `Hi ${name},`,
    "",
    "Your payment was received and your order is confirmed.",
    "",
    `*Order ID:* ${order.orderId}`,
    `*Amount paid:* ${amount}`,
    "",
    "*Items*",
    itemLines || "• (no line items)",
    "",
    "*Delivery address*",
    addressLine || "Not provided",
    "",
    "Once your order is prepared and ready to ship, we'll update you here on WhatsApp.",
    "",
    "Thank you for choosing Pure Harvests!",
  ].join("\n");
}
