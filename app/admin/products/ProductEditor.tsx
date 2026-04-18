"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type ProductPayload = {
  _id: string;
  productId: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  isActive: boolean;
};

type ProductResponse = {
  product?: ProductPayload;
  error?: string;
};

export function ProductEditor({ mode, mongoId }: { mode: "create" | "edit"; mongoId?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [productId, setProductId] = useState<string | null>(null);

  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (mode !== "edit" || !mongoId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${mongoId}`, { cache: "no-store" });
      const json = (await res.json()) as ProductResponse;
      if (!res.ok || !json.product) {
        setError(json.error ?? "Failed to load product");
        return;
      }
      const p = json.product;
      setName(p.name);
      setDescription(p.description ?? "");
      setPrice(String(p.price));
      setStock(String(p.stock));
      setIsActive(p.isActive);
      setProductId(p.productId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load product");
    } finally {
      setLoading(false);
    }
  }, [mode, mongoId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    const priceNum = Number.parseFloat(price);
    const stockNum = Number.parseInt(stock, 10);
    if (!name.trim()) {
      setError("Name is required.");
      setSaving(false);
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("Price must be a valid number ≥ 0.");
      setSaving(false);
      return;
    }
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      setError("Stock must be a whole number ≥ 0.");
      setSaving(false);
      return;
    }

    try {
      if (mode === "create") {
        const res = await fetch("/api/admin/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            price: priceNum,
            stock: stockNum,
            isActive,
          }),
        });
        const json = (await res.json()) as ProductResponse;
        if (!res.ok || !json.product?._id) {
          setError(json.error ?? "Could not create product");
          return;
        }
        router.push(`/admin/products/${json.product._id}`);
        router.refresh();
        return;
      }

      if (!mongoId) {
        setError("Missing product id.");
        return;
      }

      const res = await fetch(`/api/admin/products/${mongoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          price: priceNum,
          stock: stockNum,
          isActive,
        }),
      });
      const json = (await res.json()) as ProductResponse;
      if (!res.ok || !json.product) {
        setError(json.error ?? "Could not save changes");
        return;
      }
      setSaveMessage("Saved.");
      setProductId(json.product.productId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "create" ? "New product" : "Edit product";

  return (
    <div className="space-y-6 p-7 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand">{title}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {mode === "edit" && productId ? (
              <>
                Catalog ID:{" "}
                <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{productId}</span>
                <span className="text-zinc-400"> · </span>
              </>
            ) : null}
            {mode === "edit" && mongoId ? (
              <>
                Record: <span className="font-mono text-xs">{mongoId}</span>
              </>
            ) : (
              "Create a new SKU for your store."
            )}
          </p>
        </div>
        <Link
          href="/admin/products"
          className="rounded-2xl border border-border bg-surface px-3.5 py-2 text-sm hover:bg-surface-muted"
        >
          Back to products
        </Link>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-zinc-500">Loading…</div>
      ) : (
        <form onSubmit={onSubmit} className="max-w-xl space-y-5">
          {error ? (
            <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </p>
          ) : null}
          {saveMessage ? (
            <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              {saveMessage}
            </p>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
              placeholder="e.g. Mustard Oil 200ml"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
              placeholder="Optional details shown in admin / future storefront"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Price (INR)</span>
              <input
                required
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Stock (units)</span>
              <input
                required
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand/40"
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 rounded border-border text-brand focus:ring-brand"
            />
            <span className="text-sm">Active (visible in WhatsApp catalog when in stock)</span>
          </label>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-2xl bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_20px_-12px_rgba(47,125,74,0.75)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
