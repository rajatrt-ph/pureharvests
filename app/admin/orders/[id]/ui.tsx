"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const ORDER_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "ready_to_ship", label: "Ready to ship" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number]["value"];
type PaymentStatus = "pending" | "paid" | "failed";

type OrderItem = {
  productName: string;
  quantity: number;
  price: number;
};

type Order = {
  _id: string;
  customerName: string;
  phoneNumber: string;
  address: string;
  items: OrderItem[];
  orderValue: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  notes?: string;
  createdAt?: string;
};

type OrderResponse = {
  order?: Order;
  error?: string;
};

const LINEAR_FLOW: OrderStatus[] = ["pending", "confirmed", "ready_to_ship", "shipped", "delivered"];

function formatDate(value?: string) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function getTimelineSteps(orderStatus: OrderStatus) {
  if (orderStatus === "cancelled") {
    return [
      { key: "pending", label: "Pending", state: "done" as const },
      { key: "cancelled", label: "Cancelled", state: "current" as const },
    ];
  }

  const linear = ["pending", "confirmed", "ready_to_ship", "shipped", "delivered"] as const;
  const activeIndex = Math.max(0, linear.indexOf(orderStatus as (typeof linear)[number]));

  return linear.map((step, index) => {
    if (index < activeIndex) return { key: step, label: ORDER_STATUSES.find((s) => s.value === step)!.label, state: "done" as const };
    if (index === activeIndex) return { key: step, label: ORDER_STATUSES.find((s) => s.value === step)!.label, state: "current" as const };
    return { key: step, label: ORDER_STATUSES.find((s) => s.value === step)!.label, state: "upcoming" as const };
  });
}

function getAllowedNextStatuses(current: OrderStatus): OrderStatus[] {
  if (current === "cancelled") return ["cancelled"];

  const idx = LINEAR_FLOW.indexOf(current);
  const next = idx >= 0 ? LINEAR_FLOW[idx + 1] : undefined;
  return [current, ...(next ? [next] : []), "cancelled"];
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const styles =
    status === "paid"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "failed"
        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${styles}`}>{status}</span>;
}

export function OrderDetails({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
      const json = (await res.json()) as OrderResponse;

      if (!res.ok || !json.order) {
        setError(json.error ?? "Failed to load order");
        setOrder(null);
        return;
      }

      setOrder(json.order);
      setStatus(json.order.orderStatus);
      setNotes(json.order.notes ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load order");
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  const timelineSteps = useMemo(() => {
    if (!order) return [];
    return getTimelineSteps(order.orderStatus);
  }, [order]);

  const allowedStatuses = useMemo(() => {
    if (!order) return ORDER_STATUSES.map((s) => s.value);
    return getAllowedNextStatuses(order.orderStatus);
  }, [order]);

  async function saveChanges() {
    if (!order) return;

    setSaving(true);
    setSaveMessage(null);
    setError(null);
    const previousOrder = order;

    // Optimistic update so admin sees the new state instantly.
    setOrder({ ...order, orderStatus: status, notes });

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderStatus: status, notes }),
      });
      const json = (await res.json()) as OrderResponse;

      if (!res.ok || !json.order) {
        setOrder(previousOrder);
        setError(json.error ?? "Failed to save");
        return;
      }

      setOrder(json.order);
      setStatus(json.order.orderStatus);
      setNotes(json.order.notes ?? "");
      setSaveMessage("Changes saved.");
    } catch (e) {
      setOrder(previousOrder);
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-7 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand">Order Details</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Order ID: {orderId}</p>
        </div>
        <Link
          href="/admin/orders"
          className="rounded-2xl border border-border bg-surface px-3.5 py-2 text-sm hover:bg-surface-muted"
        >
          Back to Orders
        </Link>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-zinc-500">
          Loading order...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : order ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-surface-muted p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Customer Info
              </h2>
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  <span className="text-zinc-600 dark:text-zinc-400">Name:</span> {order.customerName}
                </p>
                <p>
                  <span className="text-zinc-600 dark:text-zinc-400">Phone:</span> {order.phoneNumber}
                </p>
                <p>
                  <span className="text-zinc-600 dark:text-zinc-400">Date:</span>{" "}
                  {formatDate(order.createdAt)}
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface-muted p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Order Summary
              </h2>
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  <span className="text-zinc-600 dark:text-zinc-400">Order Value:</span>{" "}
                  {order.orderValue.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                </p>
                <p className="flex items-center gap-2">
                  <span className="text-zinc-600 dark:text-zinc-400">Payment:</span>
                  <PaymentBadge status={order.paymentStatus} />
                </p>
                <p>
                  <span className="text-zinc-600 dark:text-zinc-400">Order Status:</span>{" "}
                  {ORDER_STATUSES.find((s) => s.value === order.orderStatus)?.label ?? order.orderStatus}
                </p>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Address
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm">{order.address}</p>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Items
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3 text-right">Price</th>
                    <th className="py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {order.items.map((item, idx) => (
                    <tr key={`${item.productName}-${idx}`}>
                      <td className="py-2 pr-3">{item.productName}</td>
                      <td className="py-2 pr-3">{item.quantity}</td>
                      <td className="py-2 pr-3 text-right">
                        {item.price.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                      </td>
                      <td className="py-2 text-right">
                        {(item.quantity * item.price).toLocaleString("en-IN", {
                          style: "currency",
                          currency: "INR",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Status Timeline
            </h2>
            <ol className="mt-3 space-y-3">
              {timelineSteps.map((step) => (
                <li key={step.key} className="flex items-center gap-3">
                  <span
                    className={[
                      "inline-flex h-3 w-3 rounded-full border",
                      step.state === "done"
                        ? "border-emerald-500 bg-emerald-500"
                        : step.state === "current"
                          ? step.key === "cancelled"
                            ? "border-red-500 bg-red-500"
                            : "border-blue-500 bg-blue-500"
                          : "border-zinc-300 bg-surface dark:border-zinc-700",
                    ].join(" ")}
                  />
                  <span
                    className={[
                      "text-sm",
                      step.state === "upcoming"
                        ? "text-zinc-500 dark:text-zinc-400"
                        : "font-medium text-zinc-900 dark:text-zinc-100",
                    ].join(" ")}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Update Order
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-4">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Order Status</span>
                <select
                  className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as OrderStatus)}
                >
                  {ORDER_STATUSES.filter((s) => allowedStatuses.includes(s.value)).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium">Notes</span>
                <textarea
                  rows={4}
                  className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal notes about this order..."
                />
              </label>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveChanges()}
                  className="rounded-2xl bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                {saveMessage ? (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">{saveMessage}</p>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

