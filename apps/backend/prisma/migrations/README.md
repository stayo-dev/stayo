# Applying a migration

`prisma migrate deploy` **must never be run against this project.** Its
`_prisma_migrations` table was never populated, so `migrate status` reports every
migration here as pending against a database that already has them — a deploy would
fail on the first `CREATE TABLE` that exists, possibly half-applied. `prisma db push`
diffs the whole schema and will drop things. `prisma db execute` is the right shape,
but its query-engine binary cannot reach the Supabase transaction pooler (it hangs, or
returns `P1001`) even though an ordinary `pg` client connects to the same URL fine.

So migrations are applied with:

```bash
cd apps/backend
npm run db:apply -- prisma/migrations/<dir>/migration.sql --dry-run   # look first
npm run db:apply -- prisma/migrations/<dir>/migration.sql             # then apply
```

It names the database it is about to write to, runs the file in a single transaction
(`--no-transaction` for `CREATE INDEX CONCURRENTLY` and friends), and then reads
`information_schema` back so "it worked" is evidence rather than the absence of an
error. `npx tsx scripts/apply-sql.ts <file>` is the same thing without the npm wrapper.

Write migrations **idempotently** — `IF NOT EXISTS`, guarded `DO $$` blocks — because
nothing tracks what has already been applied, and deliberately so: a second source of
truth about migration state is what got this project into trouble to begin with.

## Order matters

Adding a column to a Prisma model changes every query that does **not** `select` it:
Prisma requests all declared scalars on an `include`-only read. Declaring
`hostels.navigation` and deploying ahead of its migration 500'd every public listing
page in production on 2026-08-22.

**Apply the migration first, deploy the code second.** Check the blast radius before
assuming otherwise — `grep -c "include:"` around that model's reads.
