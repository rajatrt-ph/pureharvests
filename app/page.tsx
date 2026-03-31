import Image from "next/image";
import { cookies } from "next/headers";

import { HomeTopHeader } from "@/app/_components/HomeTopHeader";
import { getAdminCookieName, verifyAdminToken } from "@/lib/admin-auth";

export default async function Home() {
  let isAuthenticated = false;
  const token = (await cookies()).get(getAdminCookieName())?.value;
  if (token) {
    try {
      const payload = await verifyAdminToken(token);
      isAuthenticated = payload.sub === "admin";
    } catch {
      isAuthenticated = false;
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <HomeTopHeader isAuthenticated={isAuthenticated} />

      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 md:px-6 md:py-10">
        <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_24px_48px_-30px_rgba(23,52,31,0.45)]">
          <Image
            src="/home/hero-banner.png"
            alt="Pure Harvest banner"
            width={1600}
            height={700}
            className="h-auto w-full object-cover"
            priority
          />
          <div className="space-y-3 p-6 md:p-8">
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-brand">
              Pure Harvest Mustard Oil
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Improving the quality of life through mother nature
            </h1>
            <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
              Cold-pressed purity, authentic aroma, and traditional nourishment in every drop.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-surface p-6 shadow-[0_16px_34px_-24px_rgba(23,52,31,0.4)] md:p-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.14em] text-brand">
                Best Selling Products
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Pure Harvest Mustard Oil</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: "Pure Harvest Mustard Oil 1 Ltr", price: "₹280", image: "/home/product-1l.png" },
              { name: "Pure Harvest Mustard Oil 2 Ltr", price: "₹550", image: "/home/product-2l.png" },
              { name: "Pure Harvest Mustard Oil 5 Ltr", price: "₹1,400", image: "/home/product-5l.png" },
            ].map((product) => (
              <article
                key={product.name}
                className="rounded-2xl border border-border bg-surface-muted p-4 shadow-[0_10px_20px_-18px_rgba(23,52,31,0.55)]"
              >
                <div className="mb-3 overflow-hidden rounded-xl bg-white/80 p-3">
                  <Image
                    src={product.image}
                    alt={product.name}
                    width={500}
                    height={500}
                    className="mx-auto h-48 w-auto object-contain"
                  />
                </div>
                <h3 className="text-sm font-semibold">{product.name}</h3>
                <p className="mt-1 text-base font-medium text-brand">{product.price}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
