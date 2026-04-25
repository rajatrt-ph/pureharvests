import Link from "next/link";
import { cookies } from "next/headers";

import { HomeTopHeader } from "@/app/_components/HomeTopHeader";
import { getAdminCookieName, verifyAdminToken } from "@/lib/admin-auth";

export default async function ContactUsPage() {
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

      <main className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-3xl border border-border bg-surface p-6 shadow-[0_16px_34px_-24px_rgba(23,52,31,0.4)] md:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-brand">Contact Us</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            We are here to help
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Reach us using the details below. We usually respond within one business day.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-border bg-surface-muted p-5">
              <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-brand">Address</h2>
              <p className="mt-3 text-lg font-semibold leading-relaxed">
                Pure Harvest
                <br />
                Vill. Mubarakpur
                <br />
                Near Prathmik Vidhayla
                <br />
                Sambhal, Uttar Pradesh 244302
              </p>
            </article>

            <article className="rounded-2xl border border-border bg-surface-muted p-5">
              <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-brand">Phone Number</h2>
              <p className="mt-3 text-3xl font-bold text-brand">+91 7820098539</p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Monday to Saturday, 9:00 AM - 6:00 PM
              </p>
            </article>
          </div>

          <div className="mt-8">
            <Link
              href="/"
              className="inline-flex rounded-2xl border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted"
            >
              Back to Home
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
