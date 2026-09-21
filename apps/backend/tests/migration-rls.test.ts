import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every table a migration creates must have Row Level Security enabled by a
 * migration too.
 *
 * This is not housekeeping. `VITE_SUPABASE_ANON_KEY` is a Vite variable, so
 * the Supabase anon key is compiled into the browser bundle and is public by
 * construction; and no migration in this repo contains a REVOKE, so
 * PostgREST's default grants to `anon` and `authenticated` still stand. RLS
 * is the only thing between that public key and the table.
 *
 * Five tables shipped without it — `manager_profiles`,
 * `manager_permission_grants`, `manager_hostel_assignments`,
 * `coverage_requests`, `homepage_features` — and the second of those is a
 * writable permissions table the admin console gates access on. Migration
 * 092 closed them. This stops the next one.
 *
 * Scoped to 083 onward, where the convention demonstrably begins: earlier
 * migrations predate it and were reconciled outside this repo.
 *
 * PURE — reads migration files only.
 */

const MIGRATIONS = join(__dirname, "../../../migrations");
const CONVENTION_STARTS_AT = 83;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => {
      const n = Number(f.slice(0, 3));
      return Number.isFinite(n) && n >= CONVENTION_STARTS_AT;
    })
    .sort();
}

/** Matches both `CREATE TABLE IF NOT EXISTS foo` and `... public.foo`. */
const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const ENABLE_RLS = /ALTER\s+TABLE\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;

function namesMatching(sql: string, pattern: RegExp): Set<string> {
  const found = new Set<string>();
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) found.add(match[1].toLowerCase());
  return found;
}

describe("every table a migration creates has RLS enabled by a migration", () => {
  const files = migrationFiles();

  it("finds migrations to check, so this cannot pass on nothing", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("no table is left exposed to the public anon key", () => {
    const created = new Map<string, string>();
    const secured = new Set<string>();

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS, file), "utf8");
      for (const name of namesMatching(sql, CREATE_TABLE)) {
        if (!created.has(name)) created.set(name, file);
      }
      for (const name of namesMatching(sql, ENABLE_RLS)) secured.add(name);
    }

    const exposed = [...created.entries()]
      .filter(([name]) => !secured.has(name))
      .map(([name, file]) => `${file}: ${name}`);

    expect(exposed).toEqual([]);
  });
});
