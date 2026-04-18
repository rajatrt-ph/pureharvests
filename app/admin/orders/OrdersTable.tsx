"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ORDER_STATUSES = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Order created" },
  { value: "confirmed", label: "Confirmed" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type OrderRow = {
  _id: string;
  businessOrderId?: string;
  customerName: string;
  phoneNumber: string;
  orderValue: number;
  orderStatus: string;
  createdAt?: string;
};

type ApiResponse = {
  orders: OrderRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  error?: string;
};

type DateRangePreset = "" | "today" | "week" | "month" | "custom";

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function statusLabel(status: string) {
  const found = ORDER_STATUSES.find((s) => s.value === status);
  return found?.label ?? status;
}

export function OrdersTable() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState<DateRangePreset>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchBootstrapped = useRef(false);
  useEffect(() => {
    if (!searchBootstrapped.current) {
      searchBootstrapped.current = true;
      setSearch(searchInput.trim());
      return;
    }
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (search) p.set("search", search);
    if (status) p.set("status", status);
    if (range === "custom") {
      if (from && to) {
        p.set("range", "custom");
        p.set("from", from);
        p.set("to", to);
      }
    } else if (range) {
      p.set("range", range);
    }
    return p.toString();
  }, [page, limit, search, status, range, from, to]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders?${query}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(json.error ?? res.statusText);
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const totalPages = data?.totalPages ?? 1;
  const orders = data?.orders ?? [];

  return (
    <div className="p-7 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand">Orders</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Search by customer name, phone, or checkout order ref (ORD…). Filter by status and time range.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center">
        <label className="block flex-1">
          <span className="sr-only">Search</span>
          <input
            type="search"
            placeholder="Search name, phone, or order ref…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
          />
        </label>
        <label className="block sm:w-48">
          <span className="sr-only">Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:w-48">
          <span className="sr-only">Date range</span>
          <select
            value={range}
            onChange={(e) => {
              const next = e.target.value as DateRangePreset;
              setRange(next);
              if (next !== "custom") {
                setFrom("");
                setTo("");
              }
              setPage(1);
            }}
            className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
          >
            <option value="">All time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="custom">Custom date</option>
          </select>
        </label>

        {range === "custom" ? (
          <>
            <label className="block sm:w-44">
              <span className="sr-only">From date</span>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
              />
            </label>
            <label className="block sm:w-44">
              <span className="sr-only">To date</span>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
              />
            </label>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-surface shadow-[0_12px_24px_-20px_rgba(21,56,31,0.45)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-surface-muted text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Order ID</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No orders found.
                </td>
              </tr>
            ) : (
              orders.map((row) => (
                <tr key={row._id} className="hover:bg-brand-soft/40">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    <Link
                      href={`/admin/orders/${row._id}`}
                      className="underline decoration-zinc-300 underline-offset-2 hover:text-brand hover:decoration-brand"
                    >
                      {row._id}
                    </Link>
                    {row.businessOrderId ? (
                      <div className="mt-0.5 text-[11px] font-normal text-zinc-500">{row.businessOrderId}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-medium">{row.customerName}</td>
                  <td className="px-4 py-3">{row.phoneNumber}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {typeof row.orderValue === "number"
                      ? row.orderValue.toLocaleString("en-IN", {
                          style: "currency",
                          currency: "INR",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full border border-border bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
                      {statusLabel(row.orderStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    {formatDate(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {data != null && !loading ? (
            data.total === 0 ? (
              <>No orders yet.</>
            ) : (
              <>
                Showing{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {(page - 1) * limit + 1}–{(page - 1) * limit + orders.length}
                </span>{" "}
                of <span className="font-medium">{data.total}</span> orders
              </>
            )
          ) : (
            " "
          )}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-2xl border border-border bg-surface px-3.5 py-2 text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-2xl border border-border bg-surface px-3.5 py-2 text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
