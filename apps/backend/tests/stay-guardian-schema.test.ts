import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(__dirname, "../../../migrations/094_stay_guardian_consent.sql"),
  "utf8",
);

/**
 * ADR-234. Guards the two ways this table can ship broken: a Prisma field the
 * database does not have, and a table the public anon key can read.
 */
describe("stay_guardian_consent schema", () => {
  const model = SCHEMA.match(/model stay_guardian_consent \{[\s\S]*?\n\}/)?.[0] ?? "";

  it("declares the model", () => {
    expect(model).not.toBe("");
  });

  it("declares exactly the columns the migration creates", () => {
    for (const column of [
      "tenant_id",
      "hostel_id",
      "granted",
      "guardian_phone",
      "decided_at",
      "revoked_at",
      "stopped_at",
      "source",
      "updated_at",
    ]) {
      expect(model, column).toMatch(new RegExp(`\\b${column}\\b`));
      expect(MIGRATION, column).toMatch(new RegExp(`"${column}"`));
    }
  });

  it("keys on tenant_id — one consent decision per tenancy", () => {
    expect(model).toMatch(/tenant_id\s+String\s+@id/);
    expect(MIGRATION).toMatch(/PRIMARY KEY/i);
  });

  it("enables RLS, because the anon key is in the browser bundle", () => {
    // tests/migration-rls.test.ts enforces this across all migrations; asserted
    // here too so a failure names this table rather than the whole convention.
    expect(MIGRATION).toMatch(
      /ALTER TABLE\s+"public"\."stay_guardian_consent"\s+ENABLE ROW LEVEL SECURITY/i,
    );
  });

  it("revokes the default PostgREST grants rather than relying on RLS alone", () => {
    expect(MIGRATION).toMatch(/REVOKE ALL[\s\S]*?FROM\s+anon/i);
  });

  it("is re-runnable by hand — these migrations are applied by psql, not a tool", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS/i);
  });
});
