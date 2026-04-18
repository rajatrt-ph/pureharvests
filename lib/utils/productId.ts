/**
 * Catalog id used in carts / WhatsApp (human-readable slug, e.g. mustard-oil-1l).
 * Keep in sync with `slugifyProductId` in `scripts/seed-products.mjs`.
 */
export function slugifyProductId(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return s || "product";
}
