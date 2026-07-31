import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "./lib/auth-edge";
import { verifySupabaseAccessToken } from "./lib/auth/supabase-jwt-edge";
import { getCorsAllowOrigin } from "./lib/config/domains";
import { checkSessionRevocationEdge, checkIdleTimeoutEdge, touchSessionActivityEdge } from "./lib/redis/session-revocation-edge";

const CSRF_COOKIE_NAME = "hms_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PUBLIC_ROUTES = [
  "/api/health",
  "/api/auth/login",
  "/api/auth/owner-signup",
  "/api/auth/tenant-signup",
  "/api/auth/send-otp",
  "/api/auth/verify-otp",
  "/api/auth/send-phone-otp",
  "/api/auth/verify-phone-otp",
  "/api/auth/onboarding-login",
  "/api/leads/self-serve",
  "/api/leads/invitation",
  "/api/auth/csrf",
  "/api/tenants/activate",
  "/api/visit",
  // Meta WhatsApp Cloud API. The canonical path plus its legacy mount — both
  // are signature-verified (X-Hub-Signature-256), not session-authenticated.
  "/api/webhooks/whatsapp",
  "/api/webhooks/notifications/whatsapp",
  "/api/webhooks/payments/razorpay",
  "/api/plans",
  "/api/revalidate",
  "/api/payments/pay/",
  // Vercel-Cron hits these with `Authorization: Bearer $CRON_SECRET`,
  // which is NOT a JWT. Each route handler enforces the secret check
  // itself (see app/api/cron/*/route.ts), so middleware must step aside.
  "/api/cron",
  "/api/verify",
];

const PUBLIC_CSRF_ROUTES = [
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
];

// Every identity-bearing header this middleware ever injects. Stripped from
// every inbound request before re-setting, on every code path (including
// public routes) — a client must never be able to smuggle these in.
const IDENTITY_HEADERS = [
  "x-user-id", "x-user-role", "x-user-email", "x-owner-id", "x-tenant-id", "x-session-id",
  "x-auth-mode", "x-auth-user-id", "x-auth-email", "x-auth-session-id", "x-auth-provider", "x-auth-issued-at",
];

function stripIdentityHeaders(headers: Headers) {
  for (const h of IDENTITY_HEADERS) headers.delete(h);
}

function isValidCsrfPair(cookieToken?: string | null, headerToken?: string | null) {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length < 32 || headerToken.length < 32) return false;
  return cookieToken === headerToken;
}

/**
 * 🔐 PRODUCTION CORS & SECURITY AUDIT
 * Policy: No Wildcards Allowed + Strictly Credentialed Cookies.
 */
function getCorsHeaders(req: NextRequest) {
  const requestOrigin = req.headers.get("origin") || "";
  const origin = getCorsAllowOrigin(requestOrigin);

  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,DELETE,PATCH,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization",
    "Access-Control-Expose-Headers": "X-CSRF-Token",
    "Vary": "Origin",
  };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const corsHeaders = getCorsHeaders(req);
  const requestOrigin = req.headers.get("origin") || "";
  const isLocalDev =
    requestOrigin.includes("localhost") ||
    requestOrigin.includes("127.0.0.1") ||
    process.env.NODE_ENV !== "production";

  // 1. Handle Preflight Options Request (CORS)
  if (req.method === "OPTIONS") {
    return NextResponse.json({}, { headers: corsHeaders });
  }

  // 2. Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    const requestHeaders = new Headers(req.headers);
    stripIdentityHeaders(requestHeaders);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  // Public form endpoints do not require a logged-in JWT, but they still
  // require CSRF protection because browsers automatically attach cookies.
  if (PUBLIC_CSRF_ROUTES.some((route) => pathname.startsWith(route))) {
    if (UNSAFE_METHODS.has(req.method)) {
      const csrfCookie = req.cookies.get(CSRF_COOKIE_NAME)?.value;
      const csrfHeader = req.headers.get(CSRF_HEADER_NAME);
      if (!isLocalDev && !isValidCsrfPair(csrfCookie, csrfHeader)) {
        return NextResponse.json(
          { error: { message: "Security check failed. Refresh the page and try again.", code: "CSRF_VALIDATION_FAILED" } },
          { status: 403, headers: corsHeaders }
        );
      }
    }
    const requestHeaders = new Headers(req.headers);
    stripIdentityHeaders(requestHeaders);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  // 3. Extract Token (Priority: Header -> Cookie -> Query param for SSE)
  //    Header takes priority because the frontend explicitly sets it from
  //    localStorage on every request. The cookie may be stale on mobile
  //    browsers that block cross-origin Set-Cookie (Safari ITP, etc.).
  const authHeader = req.headers.get("authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const cookieToken = req.cookies.get("hms_session")?.value;
  const queryToken = pathname === "/api/events" ? req.nextUrl.searchParams.get("token") : null;
  const token = headerToken || cookieToken || queryToken;

  if (!token) {
    return NextResponse.json(
      { error: { message: "Authentication required", code: "UNAUTHORIZED" } },
      { status: 401, headers: corsHeaders }
    );
  }

  // 4. Verify Token — Supabase Auth (ADR-031) first, legacy HS256 as a
  //    dual-accept fallback so in-flight sessions issued before the
  //    migration cutover keep working until they naturally expire.
  const requestHeaders = new Headers(req.headers);
  stripIdentityHeaders(requestHeaders);

  let sid: string | null = null;
  let revocationSubject: string | null = null;
  let revocationIat: number | undefined;
  let authMode: "supabase" | "legacy";

  const supabaseClaims = await verifySupabaseAccessToken(token);
  if (supabaseClaims) {
    authMode = "supabase";
    requestHeaders.set("x-auth-mode", "supabase");
    requestHeaders.set("x-auth-user-id", supabaseClaims.sub);
    requestHeaders.set("x-auth-email", supabaseClaims.email || "");
    if (supabaseClaims.session_id) requestHeaders.set("x-auth-session-id", supabaseClaims.session_id);
    requestHeaders.set("x-auth-provider", supabaseClaims.app_metadata?.provider || "email");
    if (supabaseClaims.iat) requestHeaders.set("x-auth-issued-at", String(supabaseClaims.iat));
    sid = supabaseClaims.session_id || null;
    revocationSubject = supabaseClaims.sub;
    revocationIat = supabaseClaims.iat;
  } else {
    const legacyPayload = await verifyToken(token);
    if (!legacyPayload) {
      return NextResponse.json(
        { error: { message: "Invalid session", code: "UNAUTHORIZED" } },
        { status: 401, headers: corsHeaders }
      );
    }
    authMode = "legacy";
    requestHeaders.set("x-auth-mode", "legacy");
    requestHeaders.set("x-user-id", legacyPayload.sub);
    requestHeaders.set("x-user-role", legacyPayload.role);
    requestHeaders.set("x-user-email", legacyPayload.email || "");
    if (legacyPayload.owner_id) requestHeaders.set("x-owner-id", legacyPayload.owner_id);
    if (legacyPayload.tenant_id) requestHeaders.set("x-tenant-id", legacyPayload.tenant_id);
    if (legacyPayload.sid) requestHeaders.set("x-session-id", legacyPayload.sid);
    sid = legacyPayload.sid || null;
    revocationSubject = legacyPayload.sub;
    revocationIat = legacyPayload.iat;
  }

  try {
    const revocation = await checkSessionRevocationEdge({ sid, sub: revocationSubject, iat: revocationIat });
    if (!revocation.ok) {
      return NextResponse.json(
        { error: { message: "Your secure session has expired. Please sign in again.", code: "SESSION_REVOKED" } },
        { status: 401, headers: corsHeaders }
      );
    }
  } catch (error) {
    console.warn("[middleware] session revocation check unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Supabase tokens are stateless and know nothing about this app's
  // 30-minute idle-timeout rule (the legacy path enforces it Node-side via
  // sessionLifecycleService.touchSession(), unaffected by this addition).
  if (authMode === "supabase") {
    try {
      const idle = await checkIdleTimeoutEdge(sid);
      if (!idle.ok) {
        return NextResponse.json(
          { error: { message: "You've been signed out due to inactivity.", code: "SESSION_INACTIVE" } },
          { status: 401, headers: corsHeaders }
        );
      }
    } catch (error) {
      console.warn("[middleware] idle timeout check unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (UNSAFE_METHODS.has(req.method)) {
    const csrfCookie = req.cookies.get(CSRF_COOKIE_NAME)?.value;
    const csrfHeader = req.headers.get(CSRF_HEADER_NAME);
    if (!isLocalDev && !isValidCsrfPair(csrfCookie, csrfHeader)) {
      return NextResponse.json(
        { error: { message: "Security check failed. Refresh the page and try again.", code: "CSRF_VALIDATION_FAILED" } },
        { status: 403, headers: corsHeaders }
      );
    }
  }

  // 5. Attach Context & Return with CORS
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  if (sid) {
    touchSessionActivityEdge(sid).catch((error) => {
      console.warn("[middleware] session activity touch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
