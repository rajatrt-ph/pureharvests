"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { HomeTopHeader } from "@/app/_components/HomeTopHeader";

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={[
        "rounded-2xl px-3 py-2.5 text-sm transition-colors",
        isActive
          ? "bg-brand text-white shadow-sm"
          : "text-zinc-700 hover:bg-surface-muted dark:text-zinc-200 dark:hover:bg-surface-muted/60",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const year = useMemo(() => new Date().getFullYear(), []);
  const isLoginRoute = pathname === "/admin/login";

  if (isLoginRoute) {
    return <>{children}</>;
  }

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <HomeTopHeader isAuthenticated />

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 10% 5%, rgba(47,125,74,0.18), transparent 36%), radial-gradient(circle at 92% 8%, rgba(142,190,112,0.16), transparent 34%)",
        }}
      />

      <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[260px_1fr] md:gap-8 md:px-6 md:py-8">
        <aside className="rounded-3xl border border-border bg-surface/90 p-5 shadow-[0_20px_45px_-28px_rgba(23,52,31,0.42)] backdrop-blur-xl">
          <div className="mb-4">
            <div className="text-sm font-semibold tracking-tight text-brand">PureHarvests</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Admin dashboard</div>
          </div>

          <nav className="flex flex-col gap-2">
            <NavItem href="/admin/dashboard" label="Dashboard" />
            <NavItem href="/admin/orders" label="Orders" />
          </nav>

          <div className="mt-6 border-t border-border pt-4 text-xs text-zinc-500 dark:text-zinc-400">
            © {year} PureHarvests
          </div>
        </aside>

        <main className="rounded-3xl border border-border bg-surface/92 shadow-[0_16px_35px_-26px_rgba(23,52,31,0.45)] backdrop-blur-lg">
          {children}
        </main>
      </div>
    </div>
  );
}

