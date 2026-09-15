/**
 * Runtime proof that the C3 lockdown holds on a real database: as the public
 * `anon` role, every SELECT/INSERT/UPDATE/DELETE on `email_verification_otps`
 * and `_prisma_migrations` must be denied.
 *
 * Runs the shared, non-destructive assertion in scripts/verify-otp-rls.sql —
 * the same script used for post-deploy checks — so the test and the operational
 * check can never drift. The script always RAISEs (P0001): 'PASS' on success,
 * 'FAIL :: ...' otherwise, and rolls back either way.
 *
 * Self-skips when there is no database or no Supabase `anon` role (e.g. a plain
 * local Postgres), so it is inert outside a Supabase-shaped environment and
 * enforcing in CI against a migrated database.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const VERIFY_SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts/verify-otp-rls.sql"),
  "utf8",
);

let runnable = false;

beforeAll(async () => {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS present",
    )) as { present: boolean }[];
    runnable = Boolean(rows?.[0]?.present);
  } catch {
    runnable = false;
  }
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => {});
});

describe("OTP tables reject the anon role (runtime)", () => {
  it("denies anon every operation on both tables", async () => {
    if (!runnable) {
      console.warn("[otp-rls-db] skipped: no database or no `anon` role in this environment");
      return;
    }
    let message = "";
    try {
      await prisma.$executeRawUnsafe(VERIFY_SQL);
      // The script always raises; reaching here means it did not run as expected.
      throw new Error("verify-otp-rls.sql did not raise its verdict");
    } catch (err: any) {
      message = String(err?.message ?? err);
    }
    expect(message).toContain("C3_VERIFY_RESULT=PASS");
  });
});
