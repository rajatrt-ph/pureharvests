import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

const COOKIE_NAME = "ph_admin";
const JWT_ISSUER = "pureharvests-admin";
const JWT_AUDIENCE = "pureharvests-admin";

// For production, move this to an env var like ADMIN_JWT_SECRET.
const JWT_SECRET = new TextEncoder().encode("dev-only-change-me");

export type AdminSession = {
  sub: "admin";
};

export function getAdminCookieName() {
  return COOKIE_NAME;
}

export function isValidAdminCredentials(username: string, password: string) {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

export async function signAdminToken() {
  return await new SignJWT({ sub: "admin" } satisfies AdminSession)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifyAdminToken(token: string) {
  const { payload } = await jwtVerify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  return payload;
}

/** For Route Handlers: returns a 401 JSON response if the admin cookie is missing or invalid. */
export async function requireAdminSession(): Promise<NextResponse | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = await verifyAdminToken(token);
    if (payload.sub !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

