import Link from "next/link";

import { AdminLoginForm } from "./ui";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, rgba(47,125,74,0.17), transparent 38%), radial-gradient(circle at 80% 10%, rgba(150,204,123,0.16), transparent 34%)",
        }}
      />
      <div className="relative z-10 w-full max-w-sm rounded-3xl border border-border bg-surface/88 p-7 shadow-[0_24px_52px_-30px_rgba(23,52,31,0.45)] backdrop-blur-xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-brand">Admin Login</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Use your admin credentials to continue.
          </p>
        </div>

        <AdminLoginForm redirectTo={redirect} />

        <div className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          <Link
            href="/"
            className="underline underline-offset-4 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            Back to site
          </Link>
        </div>
      </div>
    </div>
  );
}

