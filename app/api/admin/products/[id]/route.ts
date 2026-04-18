import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { requireAdminSession } from "@/lib/admin-auth";
import { getProductByMongoIdForAdmin, updateProductByMongoIdForAdmin } from "@/lib/services/productService";

import { toClientProduct } from "../serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminSession();
  if (denied) return denied;

  try {
    const { id } = await params;
    const product = await getProductByMongoIdForAdmin(id);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({ product: toClientProduct(product) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminSession();
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = (await req.json()) as Partial<{
      name: string;
      description: string;
      price: number;
      stock: number;
      isActive: boolean;
    }>;

    const patch: Parameters<typeof updateProductByMongoIdForAdmin>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      patch.name = body.name;
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string") {
        return NextResponse.json({ error: "description must be a string" }, { status: 400 });
      }
      patch.description = body.description;
    }
    if (body.price !== undefined) {
      if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) {
        return NextResponse.json({ error: "price must be a number ≥ 0" }, { status: 400 });
      }
      patch.price = body.price;
    }
    if (body.stock !== undefined) {
      if (typeof body.stock !== "number" || !Number.isInteger(body.stock) || body.stock < 0) {
        return NextResponse.json({ error: "stock must be a non-negative integer" }, { status: 400 });
      }
      patch.stock = body.stock;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
      }
      patch.isActive = body.isActive;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Provide at least one of: name, description, price, stock, isActive" },
        { status: 400 },
      );
    }

    const product = await updateProductByMongoIdForAdmin(id, patch);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ product: toClientProduct(product) });
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
