import { NextResponse, type NextRequest } from "next/server";

import { getAdminCookieName, verifyAdminToken } from "@/lib/admin-auth";

const PROTECTED_PREFIXES = ["/admin/dashboard", "/admin/orders", "/admin/products"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get(getAdminCookieName())?.value;
  if (!token) {
    const url = new URL("/admin/login", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  try {
    const payload = await verifyAdminToken(token);
    if (payload.sub !== "admin") throw new Error("Invalid session");
    return NextResponse.next();
  } catch {
    const url = new URL("/admin/login", request.url);
    url.searchParams.set("redirect", pathname);

    const res = NextResponse.redirect(url);
    res.cookies.delete(getAdminCookieName());
    return res;
  }
}

export const config = {
  matcher: ["/admin/dashboard/:path*", "/admin/orders/:path*", "/admin/products/:path*"],
};

