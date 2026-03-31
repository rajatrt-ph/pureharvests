import { NextResponse } from "next/server";

import { getAdminCookieName, isValidAdminCredentials, signAdminToken } from "@/lib/admin-auth";

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    let username = "";
    let password = "";

    if (contentType.includes("application/json")) {
      const body = (await req.json()) as Partial<{ username: string; password: string }>;
      username = body.username ?? "";
      password = body.password ?? "";
    } else {
      const form = await req.formData();
      username = String(form.get("username") ?? "");
      password = String(form.get("password") ?? "");
    }

    if (!username || !password) {
      return NextResponse.json({ error: "username and password are required" }, { status: 400 });
    }

    if (!isValidAdminCredentials(username, password)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = await signAdminToken();
    const res = NextResponse.json({ ok: true });

    res.cookies.set(getAdminCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

