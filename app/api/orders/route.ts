import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { OrderModel } from "@/models/Order";

type DateRangePreset = "today" | "week" | "month" | "custom";

function computeOrderValue(
  items: Array<{ productName?: string; quantity?: number; price?: number }>,
): number {
  return items.reduce((sum, item) => {
    const qty = typeof item.quantity === "number" ? item.quantity : 0;
    const price = typeof item.price === "number" ? item.price : 0;
    return sum + qty * price;
  }, 0);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function parseDateInput(input: string) {
  const [year, month, day] = input.split("-").map((v) => Number.parseInt(v, 10));
  if (!year || !month || !day) return null;

  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export async function GET(req: Request) {
  try {
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status")?.trim() || undefined;
    const search = searchParams.get("search")?.trim() || undefined;
    const range = searchParams.get("range")?.trim() as DateRangePreset | null;
    const from = searchParams.get("from")?.trim() || undefined;
    const to = searchParams.get("to")?.trim() || undefined;

    const pageRaw = searchParams.get("page");
    const limitRaw = searchParams.get("limit");
    const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw ?? "10", 10) || 10));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (status) {
      // Treat "status" as orderStatus (most common admin filter)
      filter.orderStatus = status;
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escaped, "i");
      filter.$or = [{ customerName: rx }, { phoneNumber: rx }];
    }

    if (range) {
      if (!["today", "week", "month", "custom"].includes(range)) {
        return NextResponse.json(
          { error: "Invalid range. Use one of: today, week, month, custom." },
          { status: 400 },
        );
      }

      const now = new Date();
      const createdAt: { $gte?: Date; $lt?: Date } = {};

      if (range === "today") {
        createdAt.$gte = startOfDay(now);
        createdAt.$lt = endOfDay(now);
      } else if (range === "week") {
        const day = now.getDay();
        const weekStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - day));
        createdAt.$gte = weekStart;
        createdAt.$lt = endOfDay(now);
      } else if (range === "month") {
        createdAt.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
        createdAt.$lt = endOfDay(now);
      } else if (range === "custom") {
        if (!from || !to) {
          return NextResponse.json(
            { error: "Custom range requires both from and to dates (YYYY-MM-DD)" },
            { status: 400 },
          );
        }

        const fromDate = parseDateInput(from);
        const toDate = parseDateInput(to);

        if (!fromDate || !toDate) {
          return NextResponse.json(
            { error: "Invalid from/to date format. Use YYYY-MM-DD." },
            { status: 400 },
          );
        }
        if (fromDate > toDate) {
          return NextResponse.json(
            { error: "`from` date cannot be after `to` date." },
            { status: 400 },
          );
        }

        createdAt.$gte = startOfDay(fromDate);
        createdAt.$lt = endOfDay(toDate);
      }

      if (createdAt.$gte || createdAt.$lt) {
        filter.createdAt = createdAt;
      }
    }

    const [total, orders] = await Promise.all([
      OrderModel.countDocuments(filter),
      OrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    return NextResponse.json({
      orders,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();

    const body = (await req.json()) as Partial<{
      customerName: string;
      phoneNumber: string;
      address: string;
      items: Array<{ productName: string; quantity: number; price: number }>;
      orderValue: number;
      paymentStatus: "pending" | "paid" | "failed";
      orderStatus:
        | "pending"
        | "confirmed"
        | "ready_to_ship"
        | "shipped"
        | "delivered"
        | "cancelled";
      notes: string;
    }>;

    if (!body.customerName || !body.phoneNumber || !body.address) {
      return NextResponse.json(
        { error: "customerName, phoneNumber, and address are required" },
        { status: 400 },
      );
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: "items is required" }, { status: 400 });
    }

    const orderValue =
      typeof body.orderValue === "number" ? body.orderValue : computeOrderValue(items);

    const created = await OrderModel.create({
      customerName: body.customerName,
      phoneNumber: body.phoneNumber,
      address: body.address,
      items,
      orderValue,
      paymentStatus: body.paymentStatus ?? "pending",
      orderStatus: body.orderStatus ?? "pending",
      notes: body.notes ?? "",
    });

    return NextResponse.json({ order: created }, { status: 201 });
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

