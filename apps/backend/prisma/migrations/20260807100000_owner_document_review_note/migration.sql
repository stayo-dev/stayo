-- Reason an admin rejected an owner KYC document, shown back to the owner.
-- Additive and nullable: every existing row predates review, nothing to backfill.

ALTER TABLE "owner_documents" ADD COLUMN "review_note" TEXT;
