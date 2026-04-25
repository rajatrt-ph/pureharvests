"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function HomeTopHeader({ isAuthenticated }: { isAuthenticated: boolean }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="text-lg font-bold tracking-tight text-brand md:text-xl">
          Pure Harvest
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/contact-us"
            className="rounded-2xl border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            Contact Us
          </Link>

          <Link
            href={isAuthenticated ? "/admin/dashboard" : "/admin/login"}
            className="rounded-2xl border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            Admin Portal
          </Link>

          {isAuthenticated ? (
            <button
              type="button"
              disabled={loggingOut}
              className="rounded-2xl bg-brand px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={async () => {
                setLoggingOut(true);
                try {
                  await fetch("/api/admin/logout", { method: "POST" });
                } finally {
                  router.refresh();
                  setLoggingOut(false);
                }
              }}
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          ) : (
            <Link
              href="/admin/login"
              className="rounded-2xl bg-brand px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

