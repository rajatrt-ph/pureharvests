"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ProductRow = {
  _id: string;
  productId: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  isActive: boolean;
};

type ApiResponse = {
  products?: ProductRow[];
  error?: string;
};

function formatInr(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

export function ProductsTable() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/products", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(json.error ?? res.statusText);
        setProducts([]);
        return;
      }
      setProducts(json.products ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-7 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand">Products</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Manage catalog, pricing, and stock. Changes apply to the database and the WhatsApp storefront.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="inline-flex items-center justify-center rounded-2xl bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_20px_-12px_rgba(47,125,74,0.75)] transition-colors hover:opacity-90"
        >
          Add product
        </Link>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-surface shadow-[0_12px_24px_-20px_rgba(21,56,31,0.45)]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border bg-surface-muted text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Catalog ID</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No products yet. Add your first product to get started.
                </td>
              </tr>
            ) : (
              products.map((row) => (
                <tr key={row._id} className="hover:bg-brand-soft/40">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{row.productId}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatInr(row.price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.stock}</td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        row.isActive
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                          : "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
                      ].join(" ")}
                    >
                      {row.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/products/${row._id}`}
                      className="rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-muted"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
