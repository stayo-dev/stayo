/**
 * Clerk is the session authority on every route (ADR-204), superseding
 * ADR-176 Phase 3's "Clerk only on /api/auth/me" dual authority.
 *
 * Source-level invariants for middleware.ts, getSession() and /api/auth/me.
 * The resolver's behaviour is exercised in tests/clerk-session-resolver.test.ts.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const ROUTE = read("app/api/auth/me/route.ts");
const MIDDLEWARE = read("middleware.ts");
const GET_SESSION = read("lib/auth.ts");

describe("middleware verifies Clerk session tokens on every route", () => {
  it("runs the Clerk verifier before Supabase and legacy", () => {
    const clerkAt = MIDDLEWARE.indexOf("await verifyClerkAccessToken(token)");
    const supabaseAt = MIDDLEWARE.indexOf("await verifySupabaseAccessToken(token)");
    const legacyAt = MIDDLEWARE.indexOf("const legacyPayload = await verifyToken(token);");
    expect(clerkAt).toBeGreaterThan(-1);
    expect(supabaseAt).toBeGreaterThan(clerkAt);
    expect(legacyAt).toBeGreaterThan(supabaseAt);
  });

  it("no longer carries the /api/auth/me-only fall-through", () => {
    // That set let an unverifiable token through as anonymous on one path so
    // the route could try Clerk itself. Middleware now verifies Clerk, so a
    // token nobody accepts is a 401 everywhere.
    expect(MIDDLEWARE).not.toContain("CLERK_BEARER_ROUTES");
  });

  it("revokes Clerk tokens by the Clerk user id and session id", () => {
    const block = MIDDLEWARE.slice(MIDDLEWARE.indexOf("if (clerkClaims) {"), MIDDLEWARE.indexOf("} else if (supabaseClaims) {"));
    expect(block).toContain('requestHeaders.set("x-auth-mode", "clerk")');
    expect(block).toContain("revocationSubject = clerkClaims.sub");
    expect(block).toContain("sid = clerkClaims.sid");
  });

  it("applies the idle timeout to Clerk sessions too", () => {
    expect(MIDDLEWARE).toContain('authMode === "clerk" || authMode === "supabase"');
  });

  it("lets the capability header through CORS", () => {
    expect(MIDDLEWARE).toContain("X-Auth-Capabilities");
  });

  it("does not make /api/auth/me public", () => {
    const publicBlock = MIDDLEWARE.slice(
      MIDDLEWARE.indexOf("const PUBLIC_ROUTES = ["),
      MIDDLEWARE.indexOf("];", MIDDLEWARE.indexOf("const PUBLIC_ROUTES = [")),
    );
    expect(publicBlock).not.toContain("/api/auth/me");
  });
});

describe("getSession resolves identity by id and cuts off pre-Clerk tokens", () => {
  it("resolves a Clerk session through the id-only resolver", () => {
    expect(GET_SESSION).toContain('authMode === "clerk"');
    expect(GET_SESSION).toContain("resolveClerkSession(");
  });

  it("refuses a legacy or Supabase token for a profile that has moved onto Clerk", () => {
    const legacy = GET_SESSION.slice(GET_SESSION.indexOf('authMode === "legacy"'), GET_SESSION.indexOf('authMode === "supabase"'));
    expect(legacy).toContain("profileHasClerkLogin(userId)");
    const supabase = GET_SESSION.slice(GET_SESSION.indexOf('authMode === "supabase"'));
    expect(supabase).toContain("profileHasClerkLogin(result.payload.sub)");
  });
});

describe("/api/auth/me", () => {
  it("authenticates only through getSession — no route-local Clerk verifier", () => {
    expect(ROUTE).toContain("const session = await getSession(req);");
    expect(ROUTE).not.toContain("verifyClerkSession");
    expect(ROUTE).not.toContain("ensureUserForClerkSession");
  });

  it("explains a rejection with a specific code", () => {
    // NO_STAYO_ACCOUNT / ACCOUNT_DISABLED / TENANCY_NOT_ACTIVATED come from
    // the resolver's own result, passed straight through.
    expect(ROUTE).toContain("resolveClerkSession(");
    expect(ROUTE).toContain("apiError(result.message, result.code, 403)");
    expect(ROUTE).toContain("SIGN_IN_AGAIN");
  });

  it("never assigns a role — the profile is looked up, not created", () => {
    expect(ROUTE).not.toMatch(/\brole:\s*['"]/);
    expect(ROUTE).not.toMatch(/prisma\.profile\.(create|upsert)/);
  });

  it("logs the Prisma error code when explaining fails, which names a migration gap", () => {
    expect(ROUTE).toContain("?.code");
    expect(ROUTE).toContain("logger.error");
  });

  it("reads the profile by the id getSession returned", () => {
    expect(ROUTE).toContain("const profileId = session.sub;");
    expect(ROUTE).toContain("where: { id: profileId }");
  });
});
