-- Reason an admin rejected an owner KYC document, shown back to the owner.
-- Additive and nullable: every existing row predates review, nothing to backfill.
--
-- Made idempotent 2026-08-15 while resolving a stuck `migrate deploy`: this
-- database already had this column.

ALTER TABLE "owner_documents" ADD COLUMN IF NOT EXISTS "review_note" TEXT;
