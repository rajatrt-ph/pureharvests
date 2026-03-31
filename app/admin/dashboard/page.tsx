import { connectToDatabase } from "@/lib/db";
import { OrderModel } from "@/models/Order";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-border bg-surface-muted p-5 shadow-[0_16px_28px_-24px_rgba(21,56,31,0.48)]">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-brand">{value.toLocaleString()}</div>
    </div>
  );
}

export default async function AdminDashboardPage() {
  await connectToDatabase();

  const [totalOrders, pendingOrders, deliveredOrders] = await Promise.all([
    OrderModel.countDocuments({}),
    OrderModel.countDocuments({ orderStatus: "pending" }),
    OrderModel.countDocuments({ orderStatus: "delivered" }),
  ]);

  return (
    <div className="p-7 md:p-8">
      <div className="rounded-3xl border border-border bg-gradient-to-br from-brand-soft via-surface to-surface p-6 shadow-[0_18px_34px_-24px_rgba(21,56,31,0.44)]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand">Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Quick overview of your store activity.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total Orders" value={totalOrders} />
        <StatCard label="Pending Orders" value={pendingOrders} />
        <StatCard label="Delivered Orders" value={deliveredOrders} />
      </div>
    </div>
  );
}

