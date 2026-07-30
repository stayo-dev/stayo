/**
 * 🛡️ Authentication Hardening Security Tests
 *
 * These tests enforce the Single Owner Controlled Authentication Model.
 * Since ADR-031 (2026-07-28), Supabase Auth is the single authentication
 * provider — Google sign-in is `supabase.auth.signInWithOAuth()` on the
 * frontend, and the resulting Supabase session is resolved server-side by
 * `resolveSupabaseSession()` (lib/auth/supabase-session.ts), not a custom
 * OAuth2 code-exchange route. They verify that:
 *   1. Supabase-session resolution CANNOT auto-create any accounts
 *   2. The old Google OAuth callback route is gone, not just inert
 *   3. Owner registration is blocked without bootstrap flag
 *   4. Tenant login paths never create accounts
 *   5. JIT Supabase identity linking never silently falls back to a local UUID
 *   6. Legacy migration code is disabled
 *   7. No public route can escalate to OWNER role
 *
 * These are architectural invariant tests — they read source code to prove
 * that dangerous patterns do not exist, regardless of runtime conditions.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Supabase session resolution — No Auto-Provisioning
// ────────────────────────────────────────────────────────────────────────────

describe("Supabase session resolution: no auto-provisioning", () => {
  const sessionModule = read("lib/auth/supabase-session.ts");

  it("resolveSupabaseSession function exists", () => {
    expect(sessionModule).toContain("export async function resolveSupabaseSession(");
  });

  it("resolveSupabaseSession does NOT contain profile.create", () => {
    expect(sessionModule).not.toContain("profile.create");
    expect(sessionModule).not.toContain("prisma.profile.create");
  });

  it("resolveSupabaseSession does NOT contain findOrCreate pattern", () => {
    expect(sessionModule).not.toMatch(/create\s+new\s+profile/i);
    expect(sessionModule).not.toMatch(/first.time.*login/i);
    expect(sessionModule).not.toMatch(/default\s+to\s+OWNER/i);
  });

  it("resolveSupabaseSession rejects unknown emails with NO_STAYO_ACCOUNT", () => {
    expect(sessionModule).toContain("NO_STAYO_ACCOUNT");
    expect(sessionModule).toMatch(/no\s+account\s+found/i);
  });

  it("resolveSupabaseSession rejects TENANT accounts from Google OAuth", () => {
    expect(sessionModule).toContain("TENANT_GOOGLE_NOT_ALLOWED");
    expect(sessionModule).toMatch(/Google sign-in is not available for tenant/i);
  });

  it("resolveSupabaseSession only links on a verified email for Google", () => {
    // Strictly more verification than the raw OAuth2 flow it replaced,
    // which discarded email_verified entirely — see ADR-031.
    expect(sessionModule).toContain("emailVerified");
  });

  it("resolveSupabaseSession logs rejected attempts to event log", () => {
    expect(sessionModule).toContain("AUTH_GOOGLE_REJECTED");
    expect(sessionModule).toContain("NO_EXISTING_ACCOUNT");
    expect(sessionModule).toContain("ACCOUNT_DISABLED");
    expect(sessionModule).toContain("TENANT_GOOGLE_NOT_ALLOWED");
  });

  it("resolveSupabaseSession logs successful identity links", () => {
    expect(sessionModule).toContain("AUTH_SUPABASE_IDENTITY_LINKED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Google OAuth Callback Route — Removed, Not Bypassed
// ────────────────────────────────────────────────────────────────────────────

describe("Google OAuth callback route no longer exists", () => {
  it("app/api/auth/google-callback directory is gone", () => {
    const dirPath = path.join(root, "app/api/auth/google-callback");
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it("app/api/auth/refresh directory is gone (Supabase SDK handles refresh)", () => {
    const dirPath = path.join(root, "app/api/auth/refresh");
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it("middleware.ts no longer allow-lists google-callback as a public route", () => {
    const middleware = read("middleware.ts");
    expect(middleware).not.toContain("google-callback");
  });

  it("authService no longer exposes a googleLogin method", () => {
    const authService = read("lib/services/auth-service.ts");
    expect(authService).not.toContain("async googleLogin(");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2b. JIT Supabase Identity Linking — No Silent Local-UUID Fallback
// ────────────────────────────────────────────────────────────────────────────

describe("Supabase identity linking never silently falls back to a local UUID", () => {
  const identityModule = read("lib/auth/supabase-identity.ts");

  it("ensureSupabaseIdentity function exists", () => {
    expect(identityModule).toContain("export async function ensureSupabaseIdentity(");
  });

  it("does not contain a randomUUID fallback", () => {
    expect(identityModule).not.toContain("randomUUID");
    expect(identityModule).not.toContain("crypto.randomUUID");
  });

  it("throws loudly on Supabase failure instead of swallowing it", () => {
    expect(identityModule).toMatch(/throw new Error/);
  });

  it("looks up auth.users by a scoped $queryRaw, not the unpaginated listUsers()", () => {
    // The bug this replaced: supabase.auth.admin.listUsers() defaults to
    // page 1 and silently misses users past it. See docs/obsidian/Bugs.md.
    // Positive assertion (rather than banning the string "listUsers()"
    // outright) since this file legitimately mentions that old API by name
    // in an explanatory comment about why it's not used.
    expect(identityModule).toMatch(/prisma\.\$queryRaw[\s\S]{0,80}auth\.users/);
  });

  it("lib/auth-edge.ts still imports no Prisma (stays Edge-bundleable)", () => {
    const authEdge = read("lib/auth-edge.ts");
    expect(authEdge).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(authEdge).not.toMatch(/from\s+["'].*\/db["']/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Owner Registration — Bootstrap-Only Guard
// ────────────────────────────────────────────────────────────────────────────

describe("Owner registration is bootstrap-only", () => {
  const authService = read("lib/services/auth-service.ts");

  it("registerOwner checks for ALLOW_OWNER_BOOTSTRAP env var", () => {
    const methodStart = authService.indexOf("async registerOwner(");
    expect(methodStart).toBeGreaterThan(-1);
    const methodBody = authService.slice(methodStart, methodStart + 2000);

    expect(methodBody).toContain("ALLOW_OWNER_BOOTSTRAP");
    expect(methodBody).toContain("FORBIDDEN");
  });

  it("registerOwner logs blocked attempts", () => {
    const methodStart = authService.indexOf("async registerOwner(");
    const methodBody = authService.slice(methodStart, methodStart + 2000);

    expect(methodBody).toContain("OWNER_CREATION_BLOCKED");
  });

  it("register route requires OWNER role", () => {
    const registerRoute = read("app/api/auth/register/route.ts");

    expect(registerRoute).toContain("OWNER");
    expect(registerRoute).toMatch(/role.*OWNER|session.*role/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Email/Password Login — No Account Creation
// ────────────────────────────────────────────────────────────────────────────

describe("Email/password login: no account creation", () => {
  const authService = read("lib/services/auth-service.ts");

  it("login method does not create profiles", () => {
    // The login method is the first significant method in the class
    const loginStart = authService.indexOf("async login(");
    expect(loginStart).toBeGreaterThan(-1);

    // Extract until the next async method
    const nextMethod = authService.indexOf("async ", loginStart + 20);
    const loginBody = authService.slice(loginStart, nextMethod);

    expect(loginBody).not.toContain("profile.create");
    expect(loginBody).not.toContain("prisma.profile.create");
  });

  it("loginWithPhone does not create profiles", () => {
    const methodStart = authService.indexOf("async loginWithPhone(");
    expect(methodStart).toBeGreaterThan(-1);

    const nextMethod = authService.indexOf("async ", methodStart + 20);
    const methodBody = authService.slice(methodStart, nextMethod);

    expect(methodBody).not.toContain("profile.create");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Legacy Migration — Permanently Disabled
// ────────────────────────────────────────────────────────────────────────────

describe("Legacy tenant migration is permanently disabled", () => {
  const migrationService = read("lib/services/tenant-migration-service.ts");

  it("does not contain active profile creation code", () => {
    expect(migrationService).not.toContain("prisma.profile.create");
    expect(migrationService).not.toContain("tx.profile.create");
    expect(migrationService).not.toContain("prisma.tenants.create");
  });

  it("createMigrationTenant throws LEGACY_IMPORT_DISABLED", () => {
    expect(migrationService).toContain("LEGACY_IMPORT_DISABLED");
  });

  it("bulkImportTenants throws LEGACY_IMPORT_DISABLED", () => {
    // Count occurrences - both methods should throw
    const matches = migrationService.match(/LEGACY_IMPORT_DISABLED/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Tenant Lifecycle — Invitation-Only Profile Creation
// ────────────────────────────────────────────────────────────────────────────

describe("Tenant profiles are only created through invitation lifecycle", () => {
  it("invitation lifecycle only creates TENANT role profiles", () => {
    const lifecycleService = read("src/services/tenants/tenant-invitation-lifecycle-service.ts");

    // Every profile.create in this service must specify role: "TENANT"
    const createBlocks = lifecycleService.match(/profile\.create\(\{[\s\S]*?\}\)/g) || [];
    for (const block of createBlocks) {
      expect(block).toContain("TENANT");
      expect(block).not.toContain('"OWNER"');
      expect(block).not.toContain('"ADMIN"');
    }
  });

  it("invitation service requires owner_id context", () => {
    const invitationService = read("src/services/tenants/invitation-service.ts");

    // profile.create calls must include owner_id
    const createBlocks = invitationService.match(/profile\.create\(\{[\s\S]*?\}\)/g) || [];
    for (const block of createBlocks) {
      expect(block).toContain("owner_id");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Boot-Time Security Guard
// ────────────────────────────────────────────────────────────────────────────

describe("Boot-time owner integrity guard exists", () => {
  it("owner-integrity-guard module exists", () => {
    const guardPath = path.join(root, "lib/security/owner-integrity-guard.ts");
    expect(fs.existsSync(guardPath)).toBe(true);
  });

  it("assertOwnerIntegrity function is exported", () => {
    const guard = read("lib/security/owner-integrity-guard.ts");
    expect(guard).toContain("export async function assertOwnerIntegrity");
  });

  it("checks for unexpected owner count", () => {
    const guard = read("lib/security/owner-integrity-guard.ts");
    expect(guard).toContain("MAX_EXPECTED_OWNERS");
    expect(guard).toContain("OWNER_INTEGRITY_VIOLATION");
  });

  it("instrumentation.ts calls assertOwnerIntegrity on startup", () => {
    const instrumentation = read("instrumentation.ts");
    expect(instrumentation).toContain("assertOwnerIntegrity");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. No Public Route Creates OWNER Profiles
// ────────────────────────────────────────────────────────────────────────────

describe("No public auth route creates OWNER profiles", () => {
  const publicRoutes = [
    "app/api/auth/login/route.ts",
    "app/api/auth/onboarding-login/route.ts",
  ];

  for (const routePath of publicRoutes) {
    it(`${routePath} does not contain profile.create`, () => {
      const source = read(routePath);
      expect(source).not.toContain("profile.create");
      expect(source).not.toContain("prisma.profile.create");
    });

    it(`${routePath} does not assign OWNER role`, () => {
      const source = read(routePath);
      // Route handlers should never directly assign roles
      expect(source).not.toMatch(/role.*["']OWNER["']/);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 10. Operational Scope Guards Exist
// ────────────────────────────────────────────────────────────────────────────

describe("Operational scope guards enforce role boundaries", () => {
  const scopeModule = read("lib/auth/resolve-operational-scope.ts");

  it("resolveOwnerScope requires OWNER role", () => {
    expect(scopeModule).toContain("Owner access required");
  });

  it("resolveOwnerScope validates owner_id matches session.sub", () => {
    expect(scopeModule).toContain("owner_id mismatch");
  });

  it("resolveTenantScope requires TENANT role", () => {
    expect(scopeModule).toContain("Tenant access required");
  });
});
