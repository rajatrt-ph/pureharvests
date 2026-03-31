import { NextResponse } from "next/server";

import { getAdminCookieName } from "@/lib/admin-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(getAdminCookieName());
  return res;
}

