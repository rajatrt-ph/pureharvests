import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { requireAdminSession } from "@/lib/admin-auth";
import { createProductForAdmin, listAllProductsAdmin } from "@/lib/services/productService";

import { toClientProduct } from "./serialize";

export async function GET() {
  const denied = await requireAdminSession();
  if (denied) return denied;

  try {
    const products = await listAllProductsAdmin();
    return NextResponse.json({ products: products.map(toClientProduct) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdminSession();
  if (denied) return denied;

  try {
    const body = (await req.json()) as Partial<{
      name: string;
      description: string;
      price: number;
      stock: number;
      isActive: boolean;
    }>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const price = typeof body.price === "number" ? body.price : Number.NaN;
    const stock = typeof body.stock === "number" ? body.stock : Number.NaN;
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "price must be a number ≥ 0" }, { status: 400 });
    }
    if (!Number.isInteger(stock) || stock < 0) {
      return NextResponse.json({ error: "stock must be a non-negative integer" }, { status: 400 });
    }

    const description = typeof body.description === "string" ? body.description : "";
    const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

    const product = await createProductForAdmin({
      name,
      description,
      price,
      stock,
      isActive,
    });

    return NextResponse.json({ product: toClientProduct(product) }, { status: 201 });
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
