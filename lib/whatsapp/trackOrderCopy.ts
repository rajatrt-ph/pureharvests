import type { Order } from "@/models/Order";

const TITLE_MAX = 24;
const DESC_MAX = 72;

function truncate(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function formatInr(amount: number) {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;
}

export function formatOrderPlacedDate(createdAt?: Date | string) {
  if (!createdAt) return "—";
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function shortMonthDay(createdAt?: Date | string) {
  if (!createdAt) return "—";
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Short ref for list row — full id stays in `id` for selection. */
function compressOrderId(orderId: string) {
  if (orderId.length <= 18) return orderId;
  return `${orderId.slice(0, 7)}…${orderId.slice(-5)}`;
}

function itemLineSummary(items: Array<{ name: string; quantity?: number }>) {
  if (!items.length) return "No line items";
  const [first, ...rest] = items;
  const name = truncate(first.name, 26);
  if (rest.length === 0) {
    return first.quantity && first.quantity > 1 ? `${name} ×${first.quantity}` : name;
  }
  return `${name} +${rest.length} more`;
}

/**
 * Meta list row (title ≤24, description ≤72).
 * Industry-style: title = amount + date (quick scan); description = order ref + product summary.
 */
export function buildTrackOrderListRow(order: {
  orderId: string;
  totalAmount: number;
  items: Array<{ name: string; quantity?: number }>;
  createdAt?: Date;
}) {
  const title = truncate(`${formatInr(order.totalAmount)} · ${shortMonthDay(order.createdAt)}`, TITLE_MAX);
  const desc = truncate(`${compressOrderId(order.orderId)} · ${itemLineSummary(order.items)}`, DESC_MAX);
  return { id: order.orderId, title, description: desc };
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Order created",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function paymentLabelFromOrder(paymentStatus: string) {
  if (paymentStatus === "paid") return "Paid";
  if (paymentStatus === "failed") return "Failed";
  return "Pending";
}

function orderRef(order: Order & { _id?: { toString(): string } }) {
  const b = order.businessOrderId?.trim();
  if (b) return b;
  return order._id ? String(order._id) : "—";
}

/** Detail text for Track — uses admin `Order` document (same as dashboard). */
export function formatTrackOrderDetailFromOrder(order: Order & { _id?: { toString(): string } }) {
  const lines: string[] = [];
  lines.push(`*Order ${orderRef(order)}*`);
  lines.push("");
  lines.push(`Placed: ${formatOrderPlacedDate(order.createdAt)}`);
  lines.push(`Payment: ${paymentLabelFromOrder(order.paymentStatus)}`);
  lines.push(`Status: ${ORDER_STATUS_LABEL[order.orderStatus] ?? order.orderStatus}`);
  lines.push("");
  lines.push("*Items*");
  for (const it of order.items ?? []) {
    const line = it.price * it.quantity;
    lines.push(`• ${it.productName} × ${it.quantity} — ${formatInr(line)}`);
  }
  if (!order.items?.length) lines.push("• —");
  lines.push("");
  lines.push(`*Total:* ${formatInr(order.orderValue)}`);
  lines.push("");
  lines.push("*Delivery*");
  lines.push(order.address?.trim() || "—");
  lines.push("");
  lines.push('Reply *menu* for options or *cancel* to stop.');

  return lines.join("\n");
}
