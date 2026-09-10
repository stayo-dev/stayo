/**
 * `GET /api/auth/me` accepts a Clerk session as well as a Supabase one
 * (ADR-176 Phase 3, minimal dual session authority).
 *
 * The properties that matter: the Supabase path is untouched, Clerk is only
 * consulted when Supabase found nothing, and a Clerk session still cannot
 * invent authority — the role comes from `profiles` or the request is refused.
 *
 * Source-level invariants plus the middleware contract; the route's own
 * behaviour is covered by tests/clerk-me-handshake.test.ts, which exercises
 * `ensureUserForClerkSession` directly.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const ROUTE = read("app/api/auth/me/route.ts");
const MIDDLEWARE = read("middleware.ts");

describe("the Supabase path is unchanged", () => {
  it("still resolves a Supabase session first", () => {
    expect(ROUTE).toContain("const session = await getSession(req);");
    expect(ROUTE).toContain("resolveSupabaseSession");
  });

  it("consults Clerk only after Supabase returns nothing", () => {
    const supabaseAt = ROUTE.indexOf("await getSession(req)");
    const clerkAt = ROUTE.indexOf("clerkResolution(req)");

    expect(clerkAt).toBeGreaterThan(supabaseAt);
    // The Clerk call must sit inside the `if (!session)` branch.
    // Anchored on the profile lookup rather than the first `try {` — the Clerk
    // block now has a try of its own, and anchoring there truncated this slice.
    const branch = ROUTE.slice(
      ROUTE.indexOf("if (!session) {"),
      ROUTE.indexOf("const profile = await prisma.profile.findUnique"),
    );
    expect(branch).toContain("clerkResolution(req)");
  });

  it("keeps the Supabase-specific rejection codes", () => {
    expect(ROUTE).toContain("supabaseRejection");
  });
});

describe("the Clerk path cannot invent authority", () => {
  it("refuses a Clerk session with no linked profile", () => {
    expect(ROUTE).toContain("NO_STAYO_ACCOUNT");
  });

  it("refuses a deactivated login", () => {
    // `user.deleted` from the webhook sets is_active = false; that must not
    // become a working sign-in just because Clerk still issues a token.
    expect(ROUTE).toContain("snapshot.isActive");
    expect(ROUTE).toContain("ACCOUNT_DISABLED");
  });

  it("never assigns a role — the profile is looked up, not created", () => {
    expect(ROUTE).not.toMatch(/\brole:\s*['"]/);
    expect(ROUTE).not.toMatch(/prisma\.profile\.(create|upsert)/);
  });

  it("never lets a Clerk-path failure escape as an unlogged 500", () => {
    // This block sits outside the route's main try/catch, so an unguarded throw
    // here produced an opaque 500 with no log line — which is what made the
    // first real Clerk sign-in un-diagnosable from the outside.
    const guarded = ROUTE.slice(ROUTE.indexOf("let clerk:"), ROUTE.indexOf("if (clerk.rejection)"));
    expect(guarded).toContain("try {");
    expect(guarded).toContain("catch");
    expect(guarded).toContain("logger.error");
    expect(guarded).toContain("CLERK_RESOLUTION_FAILED");
  });

  it("logs the Prisma error code, which names a migration gap directly", () => {
    // P2021 = table missing, P2022 = column missing. Either says "migration"
    // faster than any stack trace.
    expect(ROUTE).toContain("?.code");
  });

  it("reads the profile by the id the resolver returned", () => {
    expect(ROUTE).toContain("where: { id: profileId }");
  });
});

describe("middleware lets a Clerk bearer reach the route", () => {
  it("allow-lists exactly /api/auth/me, exact-matched", () => {
    expect(MIDDLEWARE).toContain('CLERK_BEARER_ROUTES = new Set(["/api/auth/me"])');
    // A Set + .has() is an exact match. PUBLIC_ROUTES is prefix-matched, and a
    // prefix entry here would also expose /api/auth/me-anything.
    expect(MIDDLEWARE).toContain("CLERK_BEARER_ROUTES.has(pathname)");
  });

  it("falls through only after BOTH verifiers have rejected the token", () => {
    const fallthrough = MIDDLEWARE.indexOf("CLERK_BEARER_ROUTES.has(pathname)");
    const legacyCheck = MIDDLEWARE.indexOf("const legacyPayload = await verifyToken(token);");

    expect(legacyCheck).toBeGreaterThan(-1);
    expect(fallthrough).toBeGreaterThan(legacyCheck);
  });

  it("falls through as anonymous, so the route must authenticate the caller", () => {
    const idx = MIDDLEWARE.indexOf("CLERK_BEARER_ROUTES.has(pathname)");
    expect(MIDDLEWARE.slice(idx, idx + 120)).toContain("asAnonymous()");
  });

  it("does not make /api/auth/me public", () => {
    // Public means "identity headers stripped and no verification at all" for
    // every caller; this route still verifies, just with a third verifier.
    const publicBlock = MIDDLEWARE.slice(
      MIDDLEWARE.indexOf("const PUBLIC_ROUTES = ["),
      MIDDLEWARE.indexOf("];", MIDDLEWARE.indexOf("const PUBLIC_ROUTES = [")),
    );
    expect(publicBlock).not.toContain("/api/auth/me");
  });
});
