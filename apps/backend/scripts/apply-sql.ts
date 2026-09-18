/**
 * Apply one hand-written SQL migration, and prove it landed.
 *
 * ## Why this exists
 *
 * Migrations in this repo are applied by hand, because Prisma's own tooling
 * cannot be used here:
 *
 * - `prisma migrate deploy` would replay the **entire** history. This project's
 *   `_prisma_migrations` table was never populated, so `migrate status` reports
 *   all 80-odd migrations as pending against a database that already has them;
 *   it would fail on the first `CREATE TABLE` that exists, possibly half-applied.
 * - `prisma db push` diffs the whole schema and will happily drop things.
 * - `prisma db execute` is the right shape, but its query-engine binary cannot
 *   reach the Supabase transaction pooler (hangs, or `P1001`), while an ordinary
 *   `pg` client connects to the same URL without complaint.
 *
 * So "apply a migration" has meant pasting SQL into the Supabase dashboard,
 * which is exactly why several migrations have sat unapplied for weeks with
 * nobody able to say for certain which. This script is the missing piece: it
 * runs the file, in a transaction, against a database it names out loud, and
 * then reads `information_schema` back so the answer is evidence rather than
 * "it printed no errors".
 *
 * ## Usage
 *
 *   npx tsx scripts/apply-sql.ts <path-to.sql> [--dry-run] [--no-transaction]
 *
 * Reads `DATABASE_URL` from the repo-root `.env` by itself; `npm run db:apply`
 * is a convenience alias for the same thing.
 *
 *   --dry-run          connect, show the target and the statements, change nothing
 *   --no-transaction   for statements Postgres refuses to run in one, e.g.
 *                      CREATE INDEX CONCURRENTLY. A failure then leaves the
 *                      earlier statements applied — which is why it is opt-in.
 *
 * Write migrations idempotently (`IF NOT EXISTS`, guarded `DO $$` blocks) so a
 * re-run is harmless; this script does not track what it has already done, and
 * deliberately so — a second source of truth about migration state is what got
 * this project into trouble in the first place.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
// `@types/pg` is not installed, and adding a dependency for one script is a
// poor trade. Only the handful of members used here are described.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require("pg") as {
  Client: new (config: Record<string, unknown>) => {
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
    end(): Promise<void>;
  };
};
import { config as loadEnv } from "dotenv";

// Loaded here rather than relying on a wrapper script's `DOTENV_CONFIG_PATH`,
// so the documented invocation (`npx tsx scripts/apply-sql.ts <file>`) works on
// its own. Env vars already set win — dotenv does not overwrite — which keeps
// `DATABASE_URL=... npx tsx …` usable for a one-off against another database.
loadEnv({ path: resolve(__dirname, "../../../.env") });

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/** The connection string, with the password redacted for printing. */
function describe(url: string): string {
  return url.replace(/(:\/\/[^:]+):[^@]+@/, "$1:***@");
}

/**
 * Tables and indexes the file touches, so the verification afterwards is about
 * what this migration claimed to do rather than a fixed list.
 *
 * Deliberately crude: it reads the SQL as text and looks for the statements
 * this repo actually writes. A migration doing something more exotic still
 * applies correctly — it just gets no automatic verification, and says so.
 */
function targetsOf(sql: string): { tables: string[]; indexes: string[] } {
  const clean = (name: string) => name.replace(/"/g, "").replace(/^public\./, "");
  const tables = new Set<string>();
  const indexes = new Set<string>();

  const collect = (pattern: RegExp, into: Set<string>) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) into.add(clean(match[1]));
  };

  collect(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi, tables);
  collect(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi, tables);
  collect(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi, indexes);

  return { tables: Array.from(tables), indexes: Array.from(indexes) };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const noTransaction = args.includes("--no-transaction");

  if (!file) fail("Usage: npx tsx scripts/apply-sql.ts <path-to.sql> [--dry-run] [--no-transaction]");

  const path = resolve(process.cwd(), file);
  let sql: string;
  try {
    sql = readFileSync(path, "utf8");
  } catch {
    fail(`Cannot read ${path}`);
  }
  if (!sql.trim()) fail(`${path} is empty`);

  // `DATABASE_URL` is loaded by the npm script's dotenv, from the repo root.
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set — expected it in the repo-root .env");

  // pgbouncer's transaction pooling is fine for DDL, but the flag is a Prisma
  // hint and means nothing to `pg` — drop it rather than pass it as a bogus
  // libpq parameter.
  const connectionString = url.replace(/[?&]pgbouncer=true/, "");
  const targets = targetsOf(sql);

  console.log(`\n  file    ${path}`);
  console.log(`  target  ${describe(connectionString)}`);
  console.log(`  mode    ${dryRun ? "DRY RUN — nothing will be written" : noTransaction ? "apply (no transaction)" : "apply (single transaction)"}`);
  if (targets.tables.length) console.log(`  tables  ${targets.tables.join(", ")}`);
  if (targets.indexes.length) console.log(`  indexes ${targets.indexes.join(", ")}`);

  const client = new Client({
    connectionString,
    // Supabase terminates TLS at the pooler with a certificate chain Node does
    // not carry. The connection is still encrypted; what is skipped is verifying
    // the chain, which is the same posture every other client in this repo takes
    // against this host.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
    statement_timeout: 120_000,
  });

  await client.connect();
  const who = await client.query("select current_database() as db, current_user as usr");
  console.log(`  as      ${who.rows[0].usr} on ${who.rows[0].db}\n`);

  if (dryRun) {
    console.log("  Statements that would run:\n");
    console.log(sql.split("\n").map((line) => `    ${line}`).join("\n"));
    await client.end();
    console.log("\n  Nothing was written.\n");
    return;
  }

  try {
    if (!noTransaction) await client.query("BEGIN");
    // The whole file as one statement batch: `pg` sends it via the simple query
    // protocol, which is what lets `DO $$ ... $$` blocks and multiple statements
    // travel together the way they would in psql.
    await client.query(sql);
    if (!noTransaction) await client.query("COMMIT");
    console.log("  ✓ applied\n");
  } catch (error: any) {
    if (!noTransaction) await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
    fail(
      `${error?.message || error}` +
        (noTransaction
          ? "\n    Ran without a transaction, so earlier statements may have applied."
          : "\n    Rolled back — the database is unchanged."),
    );
  }

  // Read the result back rather than trusting the absence of an error.
  if (targets.tables.length) {
    const columns = await client.query(
      `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])
        order by table_name, ordinal_position`,
      [targets.tables],
    );
    console.log("  Columns now present:");
    let current = "";
    for (const row of columns.rows) {
      if (row.table_name !== current) {
        current = row.table_name;
        console.log(`\n    ${current}`);
      }
      const dflt = row.column_default ? ` default ${row.column_default}` : "";
      console.log(`      ${row.column_name} — ${row.data_type}${row.is_nullable === "NO" ? " NOT NULL" : ""}${dflt}`);
    }
    console.log("");
  }

  if (targets.indexes.length) {
    const indexes = await client.query(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])`,
      [targets.indexes],
    );
    const found = new Set<string>(indexes.rows.map((row: any) => String(row.indexname)));
    console.log("  Indexes:");
    for (const name of targets.indexes) {
      console.log(`    ${found.has(name) ? "✓" : "✗ MISSING"} ${name}`);
    }
    console.log("");
  }

  if (!targets.tables.length && !targets.indexes.length) {
    console.log("  No ALTER/CREATE TABLE or CREATE INDEX found, so nothing was verified automatically.\n");
  }

  await client.end();
}

main().catch((error) => fail(error?.message || String(error)));
