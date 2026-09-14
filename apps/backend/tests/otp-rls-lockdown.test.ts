/**
 * `email_verification_otps` and `_prisma_migrations` must never again ship
 * reachable by the public PostgREST roles (C3, 2026-09-14 security audit).
 *
 * Two layers:
 *  - Source-level (this file, pure suite, always runs): the lockdown migration
 *    exists and still enables RLS + revokes anon/authenticated on both tables,
 *    and the OTP service reaches its table through Prisma (the RLS-bypassing
 *    backend connection), never a browser Supabase client that would need those
 *    grants back. This is what prevents a silent regression *in the repo* — a
 *    deleted migration or a new anon read path fails here.
 *  - Runtime (tests/otp-rls-db.test.ts, DB-backed): proves anon is actually
 *    denied every operation, against a database with the migration applied.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = fs.readFileSync(
  path.join(root, "prisma/migrations/20260916000000_otp_tables_rls_lockdown/migration.sql"),
  "utf8",
);
const otpService = fs.readFileSync(path.join(root, "lib/services/auth/email-otp-service.ts"), "utf8");

const TABLES = ["email_verification_otps", "_prisma_migrations"] as const;

describe("OTP-table lockdown migration", () => {
  for (const table of TABLES) {
    it(`enables RLS on ${table}`, () => {
      expect(MIGRATION).toMatch(new RegExp(`ALTER TABLE\\s+"${table}"\\s+ENABLE ROW LEVEL SECURITY`));
    });

    it(`revokes anon and authenticated on ${table}`, () => {
      const revoke = new RegExp(`REVOKE ALL ON TABLE\\s+"${table}"\\s+FROM anon, authenticated`);
      expect(MIGRATION).toMatch(revoke);
    });
  }

  it("creates no policy that would re-open either backend-only table", () => {
    // Deny-all is the intent: no CREATE POLICY belongs in this migration.
    expect(MIGRATION).not.toMatch(/CREATE POLICY/i);
  });

  it("never re-grants either public role", () => {
    expect(MIGRATION).not.toMatch(/GRANT\s+.*\bTO\b\s+(anon|authenticated)/i);
  });
});

describe("email OTP storage stays on the backend connection", () => {
  it("reaches the table through Prisma, not a browser Supabase client", () => {
    expect(otpService).toMatch(/prisma[\s\S]{0,40}emailVerificationOtp/);
    // A `supabase.from('email_verification_otps')` call would run as anon/
    // authenticated and depend on the very grants this migration removes.
    expect(otpService).not.toMatch(/\.from\(\s*['"]email_verification_otps['"]/);
    expect(otpService).not.toMatch(/createClient\(/);
  });
});
