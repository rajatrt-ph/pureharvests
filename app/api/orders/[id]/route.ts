import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { notifyCustomerOrderStatusChange } from "@/lib/notifications/orderStatusWhatsApp";
import { OrderModel } from "@/models/Order";

/** Linear lifecycle: created → confirmed (paid) → shipped → delivered. */
const ORDER_STATUS_FLOW = ["pending", "confirmed", "shipped", "delivered"] as const;
const ORDER_STATUS_VALUES = [...ORDER_STATUS_FLOW, "cancelled"] as const;

type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

function isValidObjectId(id: string) {
  return mongoose.Types.ObjectId.isValid(id);
}

function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUS_VALUES.includes(value as OrderStatus);
}

function canTransitionOrderStatus(current: OrderStatus, next: OrderStatus) {
  if (next === "cancelled") return true;
  if (current === "cancelled") return false;
  if (current === next) return true;

  const currentIndex = ORDER_STATUS_FLOW.indexOf(current as (typeof ORDER_STATUS_FLOW)[number]);
  const nextIndex = ORDER_STATUS_FLOW.indexOf(next as (typeof ORDER_STATUS_FLOW)[number]);

  return currentIndex >= 0 && nextIndex === currentIndex + 1;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();

    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const order = await OrderModel.findById(id).lean();
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();

    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json()) as Partial<{
      orderStatus: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
      notes: string;
    }>;

    const requestedStatus =
      typeof body.orderStatus === "string" ? body.orderStatus : undefined;
    const requestedNotes = typeof body.notes === "string" ? body.notes : undefined;

    if (!requestedStatus && requestedNotes === undefined) {
      return NextResponse.json(
        { error: "Provide at least one of: orderStatus, notes" },
        { status: 400 },
      );
    }

    if (requestedStatus && !isOrderStatus(requestedStatus)) {
      return NextResponse.json({ error: "Invalid orderStatus value" }, { status: 400 });
    }

    const order = await OrderModel.findById(id);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const previousStatus = order.orderStatus as OrderStatus;

    if (requestedStatus) {
      const currentStatus = order.orderStatus as OrderStatus;
      if (!canTransitionOrderStatus(currentStatus, requestedStatus)) {
        return NextResponse.json(
          {
            error:
              "Invalid status transition. Allowed flow: pending -> confirmed -> shipped -> delivered, cancelled anytime.",
          },
          { status: 400 },
        );
      }
      order.orderStatus = requestedStatus;
    }

    if (requestedNotes !== undefined) {
      order.notes = requestedNotes;
    }

    const updated = await order.save();
    const plain = updated.toObject();

    if (requestedStatus && previousStatus !== requestedStatus) {
      void notifyCustomerOrderStatusChange(
        {
          phoneNumber: plain.phoneNumber,
          customerName: plain.customerName,
          businessOrderId: typeof plain.businessOrderId === "string" ? plain.businessOrderId : undefined,
          orderStatus: plain.orderStatus,
          _id: plain._id,
        },
        previousStatus,
      );
    }

    return NextResponse.json({ order: plain });
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

