/**
 * 🆕 Google Auto-Provisioning Tests (2026-08-16)
 *
 * `resolveSupabaseSession()` stays hard-tested to never auto-provision (see
 * auth-hardening-security.test.ts, "No Auto-Provisioning") — this suite
 * verifies the new, separate provisioning path added alongside it:
 * `provisionMarketplaceTenantFromSupabase()` (lib/auth/supabase-provision.ts),
 * reachable only from `POST /api/auth/google/provision`.
 *
 * Same static-analysis style as auth-hardening-security.test.ts — these read
 * source to prove invariants hold regardless of runtime conditions, rather
 * than hitting a live database.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("resolveSupabaseSession is untouched by provisioning", () => {
  const sessionModule = read("lib/auth/supabase-session.ts");

  it("resolveSupabaseSession still contains no profile.create — provisioning was NOT added here", () => {
    expect(sessionModule).not.toContain("profile.create");
    expect(sessionModule).not.toContain("prisma.profile.create");
  });

  it("resolveSupabaseSession still rejects unknown emails with NO_STAYO_ACCOUNT", () => {
    expect(sessionModule).toContain("NO_STAYO_ACCOUNT");
  });
});

describe("provisionMarketplaceTenantFromSupabase — narrow, gated provisioning", () => {
  const provisionModule = read("lib/auth/supabase-provision.ts");

  it("function exists and is exported", () => {
    expect(provisionModule).toContain("export async function provisionMarketplaceTenantFromSupabase(");
  });

  it("delegates to resolveSupabaseSession rather than building a second session-resolution path", () => {
    expect(provisionModule).toContain("resolveSupabaseSession(ctx)");
  });

  it("checks for an existing profile by email before ever creating one", () => {
    const fnStart = provisionModule.indexOf("export async function provisionMarketplaceTenantFromSupabase(");
    const createIdx = provisionModule.indexOf("prisma.profile.create", fnStart);
    const existingCheckIdx = provisionModule.indexOf("prisma.profile.findUnique", fnStart);
    expect(existingCheckIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(existingCheckIdx);
  });

  it("only provisions from a verified Google identity", () => {
    expect(provisionModule).toContain('ctx.provider !== "google"');
    expect(provisionModule).toContain("!ctx.emailVerified");
  });

  it("new profiles are role TENANT with no owner_id and no tenants row created", () => {
    const createBlockMatch = provisionModule.match(/prisma\.profile\.create\(\{[\s\S]*?\}\)/);
    expect(createBlockMatch).not.toBeNull();
    const createBlock = createBlockMatch![0];
    expect(createBlock).toContain('role: "TENANT"');
    expect(createBlock).not.toContain("owner_id:");
    expect(provisionModule).not.toContain("tenants.create");
  });

  it("rate-limits provisioning via the existing rate-limit primitive, not a new one", () => {
    expect(provisionModule).toContain("checkFixedWindowLimit");
    expect(provisionModule).toContain("google-provision:email");
  });

  it("logs both rejected and successful provisioning attempts", () => {
    expect(provisionModule).toContain("AUTH_GOOGLE_REJECTED");
    expect(provisionModule).toContain("AUTH_GOOGLE_PROVISIONED");
  });
});

describe("POST /api/auth/google/provision — entry point is gated and narrow", () => {
  const routeModule = read("app/api/auth/google/provision/route.ts");

  it("requires an already-valid Supabase session (x-auth-mode: supabase)", () => {
    expect(routeModule).toContain('x-auth-mode") !== "supabase"');
  });

  it("calls provisionMarketplaceTenantFromSupabase, not resolveSupabaseSession directly", () => {
    expect(routeModule).toContain("provisionMarketplaceTenantFromSupabase(");
  });

  it("does not mint or return session tokens itself (ADR-031: Supabase is the sole session authority)", () => {
    expect(routeModule).not.toContain("access_token");
    expect(routeModule).not.toContain("refresh_token");
    expect(routeModule).not.toContain("createSessionAndTokens");
  });
});

describe("Owner/admin auto-provisioning is not exposed", () => {
  const loginModal = read("../frontend/src/shared/ui-patterns/LoginModal.tsx");

  it("submitGoogle branches on isOwner before deciding which Google call to make", () => {
    const fnStart = loginModal.indexOf("const submitGoogle = async () => {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = loginModal.slice(fnStart, fnStart + 400);
    expect(fnBody).toContain("if (isOwner)");
    expect(fnBody).toContain("await loginWithGoogle();");
    expect(fnBody).toContain("await loginWithGoogleAllowProvision();");
  });

  it("owner mode never calls the provisioning-allowed variant", () => {
    const fnStart = loginModal.indexOf("const submitGoogle = async () => {");
    const fnEnd = loginModal.indexOf("};", fnStart);
    const fnBody = loginModal.slice(fnStart, fnEnd);
    const ownerBranchStart = fnBody.indexOf("if (isOwner)");
    const ownerBranchEnd = fnBody.indexOf("} else {", ownerBranchStart);
    const ownerBranch = fnBody.slice(ownerBranchStart, ownerBranchEnd);
    expect(ownerBranch).not.toContain("loginWithGoogleAllowProvision");
  });
});

describe("AuthContext: provisioning-allowed Google login is a distinct, separately named method", () => {
  const authContext = read("../frontend/src/context/AuthContext.tsx");

  it("loginWithGoogleAllowProvision exists alongside the untouched loginWithGoogle", () => {
    expect(authContext).toContain("const loginWithGoogle = async (): Promise<void> => {");
    expect(authContext).toContain("const loginWithGoogleAllowProvision = async (");
  });

  it("loginWithGoogleAllowProvision delegates to loginWithGoogle rather than duplicating the redirect", () => {
    const fnStart = authContext.indexOf("const loginWithGoogleAllowProvision = async (");
    const fnEnd = authContext.indexOf("\n  };", fnStart);
    const fnBody = authContext.slice(fnStart, fnEnd);
    expect(fnBody).toContain("await loginWithGoogle();");
  });
});
