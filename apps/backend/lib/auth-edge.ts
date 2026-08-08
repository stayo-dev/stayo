/**
 * Edge-compatible auth utilities.
 * This file MUST NOT import any Node.js-only modules (e.g. bcryptjs).
 * It is used by middleware.ts which runs in the Edge Runtime.
 */
import { jwtVerify, SignJWT } from "jose";
import { NextResponse } from "next/server";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "default_hms_secret_key_change_me");

export interface AuthPayload {
  sub: string;
  email: string;
  role: string;
  owner_id?: string | null;
  tenant_id?: string | null;
  sid?: string | null;
  iat?: number;
}

function assertOwnerPayload(payload: AuthPayload) {
  if (payload.role === "OWNER" && !payload.owner_id) {
    throw new Error("Invalid OWNER: missing owner_id");
  }
}

export async function generateToken(payload: AuthPayload) {
  assertOwnerPayload(payload);
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(JWT_SECRET);
}

/**
 * Generate a short-lived token (60s) for SSE connections.
 * Even if URL-logged, it expires almost immediately.
 */
export async function generateShortToken(payload: AuthPayload) {
  assertOwnerPayload(payload);
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(JWT_SECRET);
}

/**
 * Verify JWT token without DB checks (Edge compatible)
 */
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as AuthPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Generate a 2-minute single-use identity confirmation token.
 *
 * Claims:
 *  - jti:     unique token ID — persisted in DB and consumed on first use
 *  - purpose: broad scope ("OFFLINE_PAYMENT") — matches DB record
 *  - action:  specific operation ("record_offline_payment") — prevents reuse
 *             across future sensitive actions even with the same purpose
 *
 * A regular session token never carries these claims, and this token never
 * carries role/email — the two types are fully disjoint.
 */
export async function generateIdentityToken(
  userId: string,
  purpose: string,
  jti: string,
  action: string
): Promise<string> {
  return new SignJWT({ sub: userId, purpose, action, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(JWT_SECRET);
}

/**
 * Verify an identity token and confirm purpose + action claims.
 * Returns { userId, jti, action } on success; null on any failure.
 * The caller is responsible for DB-level single-use enforcement using the jti.
 */
export async function verifyIdentityToken(
  token: string,
  expectedPurpose: string,
  expectedAction: string
): Promise<{ userId: string; jti: string; action: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload.purpose !== expectedPurpose) return null;
    if (payload.action !== expectedAction) return null;
    if (!payload.sub || !payload.jti) return null;
    return {
      userId: payload.sub as string,
      jti: payload.jti as string,
      action: payload.action as string,
    };
  } catch {
    return null;
  }
}

/** How the holder of a reset token proved they own the account. */
export type ResetChannel = "email" | "phone";

/**
 * Generate a single-use secure password reset token.
 *
 * Defaults reproduce the emailed-link behavior this has always had: a
 * 1-hour token on the `email` channel. The phone/OTP reset path overrides
 * both — its token is handed straight back in an API response rather than
 * mailed to an inbox, so it gets minutes, not an hour.
 */
export async function generateResetToken(
  email: string,
  options: { expiresIn?: string; channel?: ResetChannel } = {},
): Promise<string> {
  const { expiresIn = "1h", channel = "email" } = options;
  return new SignJWT({ email, action: "password_reset", channel })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

/**
 * Verify a password reset token.
 *
 * A token with no `channel` claim is an emailed link minted before the
 * channel existed — those are still sitting in real inboxes, so they read
 * as `email` rather than failing.
 */
export async function verifyResetToken(
  token: string,
): Promise<{ email: string; channel: ResetChannel } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload.action !== "password_reset" || !payload.email) return null;
    return {
      email: payload.email as string,
      channel: payload.channel === "phone" ? "phone" : "email",
    };
  } catch {
    return null;
  }
}


export function apiResponse(data: any, status = 200) {
  return NextResponse.json({
    success: true,
    ...(typeof data === 'object' && !Array.isArray(data) ? data : { data })
  }, { status });
}

export function apiError(message: string, code = "ERROR", status = 500, details?: any) {
  return NextResponse.json({ 
    success: false,
    error: { message, code, ...(details !== undefined ? { details } : {}) }
  }, { status });
}
