"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function AdminLoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    if (redirectTo && redirectTo.startsWith("/admin/")) return redirectTo;
    return "/admin/dashboard";
  }, [redirectTo]);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);

        try {
          const form = e.currentTarget;
          const formData = new FormData(form);

          const res = await fetch("/api/admin/login", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            setError(data?.error ?? "Login failed");
            return;
          }

          router.push(nextPath);
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Login failed");
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none ring-0 focus:border-brand/40"
          required
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none ring-0 focus:border-brand/40"
          required
          disabled={pending}
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="inline-flex w-full items-center justify-center rounded-2xl bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_20px_-12px_rgba(47,125,74,0.75)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

