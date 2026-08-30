export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { activationSubjectFromRequest } from "@/src/services/tenants/activation-request-subject";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, getSessionCookieOptions, TENANT_REFRESH_DAYS } from "@/lib/services/session-lifecycle-service";
import { setCsrfCookie } from "@/lib/security/csrf";
import { apiError, apiResponse } from "@/lib/auth";
import { invitationService } from "@/src/services/tenants/invitation-service";
import { ActivationSchema } from "@/lib/validators";
import { activationWorkflowService } from "@/src/services/tenants/activation-workflow-service";
import { withOnboardingMetrics } from "@/lib/onboarding-metrics";

const FINANCIAL_ERROR_CODES = new Set([
  "DEPOSIT_OUTSTANDING",
  "MAINTENANCE_OUTSTANDING",
  "ONBOARDING_FINANCIALS_INCOMPLETE",
]);

function normalizeActivationError(error: any, fallback: string) {
  if (error?.code && FINANCIAL_ERROR_CODES.has(String(error.code))) {
    return {
      code: String(error.code),
      message: String(error.message || fallback),
      status: Number(error.status || 409),
      details: error.details,
    };
  }

  const rawMessage = String(error?.message || fallback);
  const [maybeCode, ...rest] = rawMessage.split(":");
  const normalizedCode = rest.length > 0 ? maybeCode?.trim() : "ACTIVATION_ERROR";
  const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;
  return { code: normalizedCode, message: normalizedMessage, status: undefined, details: undefined };
}

/**
 * 🔐 Tenant Activation
 * POST /api/tenants/activate
 * Access: Public (token-based)
 */

function createActivationResponse(result: any, startedAt: number) {
  if (result && typeof result === "object" && "session" in result && result.session) {
    const { session, ...restResult } = result;

    // ADR-031: refresh_token stays IN `session` here (unlike the old
    // behavior) — the frontend needs it for supabase.auth.setSession()
    // after activation. See the identical note in app/api/auth/login/route.ts.
    const response = NextResponse.json({
      success: true,
      ...restResult,
      session,
    }, { status: 200 });

    response.cookies.set("hms_session", session.access_token, {
      ...getSessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS),
    });

    response.cookies.set("hms_refresh_token", session.refresh_token, {
      ...getSessionCookieOptions(60 * 60 * 24 * TENANT_REFRESH_DAYS),
    });
    setCsrfCookie(response, 60 * 60 * 24 * TENANT_REFRESH_DAYS);

    return withOnboardingMetrics(response, { startedAt, payload: restResult });
  }

  return withOnboardingMetrics(apiResponse(result, 200), { startedAt, payload: result });
}

export async function POST(req: NextRequest) {
  const startedAt = performance.now();
  try {
    const body = await req.json();
    const validated = ActivationSchema.safeParse(body);

    if (!validated.success) {
      return withOnboardingMetrics(apiError("Validation failed", "VALIDATION_ERROR", 400), { startedAt });
    }

    const { token, password, confirm_password } = validated.data;
    if (password !== confirm_password) {
      return withOnboardingMetrics(apiError("Passwords do not match", "VALIDATION_ERROR", 400), { startedAt });
    }

    const result = await invitationService.activateTenant(token, password);
    return createActivationResponse(result, startedAt);
  } catch (error: any) {
    const normalized = normalizeActivationError(error, "Failed to activate account");

    const statusMap: Record<string, number> = {
      INVALID: 400,
      VALIDATION_ERROR: 400,
      BAD_REQUEST: 400,
      NOT_FOUND: 404,
      INTERNAL_ERROR: 500,
      DEPOSIT_OUTSTANDING: 409,
      MAINTENANCE_OUTSTANDING: 409,
      ONBOARDING_FINANCIALS_INCOMPLETE: 409,
      // `activateTenant` -> mutate(ACTIVATE) -> resolveInvitation also
      // reaches resolveByToken. Same mapping as the other branches in this
      // file for defense in depth.
      CLAIM_REQUIRED: 409,
    };

    const status = normalized.status || statusMap[normalized.code] || 500;
    return withOnboardingMetrics(apiError(normalized.message, normalized.code || "ACTIVATION_ERROR", status, normalized.details), {
      startedAt,
      payload: { code: normalized.code, message: normalized.message, details: normalized.details },
    });
  }
}

/**
 * Backend-controlled activation workflow mutation.
 * PATCH /api/tenants/activate
 * Body: { token, step, data }
 */
export async function PATCH(req: NextRequest) {
  const startedAt = performance.now();
  try {
    const body = await req.json();
    const token = String(body?.token || "").trim();
    const step = String(body?.step || "").trim().toUpperCase() as any;
    // See the context route: a claimed tenant carries a session, not a token.
    const subject = await activationSubjectFromRequest(req, token);
    if (!subject.ok) return withOnboardingMetrics(apiError(subject.message || "Activation token is required", subject.code || "VALIDATION_ERROR", 400), { startedAt });

    const result = await activationWorkflowService.mutate(subject, step, body?.data || {}, {
      ip: req.headers.get("x-forwarded-for") || req.ip || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
    });
    return createActivationResponse(result, startedAt);
  } catch (error: any) {
    const normalized = normalizeActivationError(error, "Failed to update activation workflow");

    const statusMap: Record<string, number> = {
      INVALID: 410,
      EXPIRED: 410,
      ALREADY_ACTIVE: 409,
      CANCELLED: 410,
      INVALID_TRANSITION: 409,
      VALIDATION_ERROR: 400,
      BAD_REQUEST: 400,
      NOT_FOUND: 404,
      INTERNAL_ERROR: 500,
      DEPOSIT_OUTSTANDING: 409,
      MAINTENANCE_OUTSTANDING: 409,
      ONBOARDING_FINANCIALS_INCOMPLETE: 409,
      // See the identical entry (and its comment) in
      // app/api/tenants/activate/context/route.ts -- `mutate` reaches the
      // same resolveByToken via resolveInvitation, so a step submitted
      // against a link superseded by adoption mid-flow needs the same
      // mapping, for defense in depth (GET .../context is the path the
      // frontend actually hits first and where a tenant would normally
      // already have been redirected).
      CLAIM_REQUIRED: 409,
    };

    const status = normalized.status || statusMap[normalized.code] || 500;
    return withOnboardingMetrics(apiError(normalized.message, normalized.code || "ACTIVATION_ERROR", status, normalized.details), {
      startedAt,
      payload: { code: normalized.code, message: normalized.message, details: normalized.details },
    });
  }
}

export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return withOnboardingMetrics(apiError("Activation token is required", "VALIDATION_ERROR", 400), { startedAt });

    const result = await invitationService.validateActivationToken(token);
    return withOnboardingMetrics(apiResponse(result, 200), { startedAt, payload: result });
  } catch (error: any) {
    const rawMessage = String(error?.message || "Failed to validate activation link");
    const [maybeCode, ...rest] = rawMessage.split(":");
    const normalizedCode = maybeCode?.trim();
    const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;

    const statusMap: Record<string, number> = {
      INVALID: 410,
      VALIDATION_ERROR: 400,
      INTERNAL_ERROR: 500,
      // `validateActivationToken` calls resolveByToken directly too. Same
      // mapping as the other two branches in this file.
      CLAIM_REQUIRED: 409,
    };

    const status = statusMap[normalizedCode] || 500;
    return withOnboardingMetrics(apiError(normalizedMessage, normalizedCode || "ACTIVATION_ERROR", status), {
      startedAt,
      payload: { code: normalizedCode, message: normalizedMessage },
    });
  }
}
