export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { authService } from "@/lib/services/auth-service";
import { generateIdentityToken } from "@/lib/auth-edge";
import { apiError } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const logger = getLogger("auth.confirm-identity");

// Every (purpose, action) pair a verifier in the codebase actually checks for.
// Adding a new financially-sensitive confirmation flow means adding its pair
// here — the route only ever issues tokens for a purpose/action combination a
// verifier is known to expect.
const ALLOWED_PURPOSES: Record<string, { action: string }> = {
  OFFLINE_PAYMENT: { action: "record_offline_payment" },
  WAIVE_OBLIGATION: { action: "waive_obligation" },
  CANCEL_OBLIGATION: { action: "cancel_obligation" },
  CHANGE_RENT: { action: "change_rent" },
  CHANGE_FREQUENCY: { action: "change_frequency" },
  CREATE_HOSTEL: { action: "create_hostel" },
};
const DEFAULT_PURPOSE = "OFFLINE_PAYMENT";
const TOKEN_TTL_MS    = 2 * 60 * 1000; // 2 minutes

// DB-based rate limit — survives deploys and works across all instances.
// Tracks failed attempts only; success clears the concern naturally.
const FAIL_WINDOW_MS = 60_000;
const FAIL_MAX       = 5;

/**
 * POST /api/auth/confirm-identity
 *
 * Step 1 of secure offline payment flow.
 *
 * Issues a SHORT-LIVED, SINGLE-USE identity token:
 *  - jti persisted in identity_tokens table (consumed atomically with payment)
 *  - purpose + action claims bind it to exactly one operation
 *  - 2-minute TTL — short enough to be useless if intercepted
 *  - No role/email claims — cannot be used as a session token
 *
 * Rate limiting: DB-based (ActionLog action=IDENTITY_FAIL)
 *  - Works across all server instances / deploys
 *  - 5 failed attempts per minute → 429
 *  - Failed attempt logged; success does NOT log (avoid polluting audit trail)
 */
export async function POST(req: Request) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      console.warn("[confirm-identity] Unauthorized access attempt");
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }
    
    if (user.role !== "OWNER") {
      console.warn(`[confirm-identity] Forbidden access attempt by ${user.role} ${user.id}`);
      return apiError("Only owners can perform this action", "FORBIDDEN", 403);
    }

    // ── DB-based rate limit: count recent IDENTITY_FAIL actions ──────────────
    const failWindowStart = new Date(Date.now() - FAIL_WINDOW_MS);
    const recentFails = await prisma.actionLog.count({
      where: { owner_id: user.id, action: "IDENTITY_FAIL", created_at: { gte: failWindowStart } },
    });
    
    if (recentFails >= FAIL_MAX) {
      logger.warn("auth.confirm_identity.rate_limited", { user_id: user.id, recent_fails: recentFails });
      return apiError("Too many failed attempts. Please wait a minute before trying again.", "RATE_LIMIT", 429);
    }

    const body = await req.json().catch(() => ({}));
    const { password } = body;
    const requestedPurpose = typeof body.purpose === "string" ? body.purpose : DEFAULT_PURPOSE;

    if (!password || typeof password !== "string" || password.length < 1) {
      return apiError("Password is required", "VALIDATION_ERROR", 400);
    }

    const purposeEntry = ALLOWED_PURPOSES[requestedPurpose];
    if (!purposeEntry) {
      return apiError(`Unsupported purpose: ${requestedPurpose}`, "VALIDATION_ERROR", 400);
    }
    const identityPurpose = requestedPurpose;
    const identityAction = purposeEntry.action;

    const isValid = await authService.verifyUserPassword(user.id, password);

    if (!isValid) {
      // Log the failure — contributes to the rate-limit window
      await prisma.actionLog.create({
        data: { id: randomUUID(), owner_id: user.id, action: "IDENTITY_FAIL" },
      });
      logger.warn("auth.confirm_identity.invalid_password", { user_id: user.id });
      return apiError("Invalid credentials", "UNAUTHORIZED", 401);
    }

    // ── Issue single-use identity token ──────────────────────────────────────
    const jti       = randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    // Persist the token record BEFORE signing — if DB write fails, no JWT is issued
    await prisma.identity_tokens.create({
      data: {
        jti,
        user_id: user.id,
        purpose: identityPurpose,
        action: identityAction,
        expires_at: expiresAt,
        used: false,
      },
    });

    const identityToken = await generateIdentityToken(
      user.id, identityPurpose, jti, identityAction
    );

    logger.info("auth.confirm_identity.issued", { user_id: user.id, jti, purpose: identityPurpose });

    return NextResponse.json({
      success: true,
      identity_token: identityToken,
      expires_in: 120,
      purpose: identityPurpose,
    });
  } catch (error: any) {
    console.error("Detailed API Error [confirm-identity]:", error);
    logger.error("auth.confirm_identity.error", { error: error.message });
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
