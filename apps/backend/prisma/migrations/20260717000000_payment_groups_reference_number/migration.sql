-- Schema-drift fix: payment_groups.reference_number exists in schema.prisma
-- but was never captured in a migration (likely added via `db push` against
-- a dev/test database at some point). This is why every payment recording
-- through the Settlement Engine (payment_groups.create()) has been failing
-- in production with "column reference_number does not exist" — the
-- generated Prisma Client selects it back by default on every create.
-- Purely additive, nullable, no backfill needed.

ALTER TABLE "payment_groups" ADD COLUMN IF NOT EXISTS "reference_number" TEXT;
