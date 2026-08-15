-- Reverts a mistake in the previous migration: `aadhaar_number` was
-- deliberately removed from `tenants` in an earlier pass (see the comment on
-- `TenantProfileUpdateSchema` — "aadhaar_number removed - now stored in
-- identification_documents table"). Aadhaar is tracked via the uploaded
-- AADHAAR document's `doc_number`, not a separate tenant column.
ALTER TABLE "public"."tenants" DROP COLUMN IF EXISTS "aadhaar_number";
