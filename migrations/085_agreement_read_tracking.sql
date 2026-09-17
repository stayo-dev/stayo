-- 085_agreement_read_tracking.sql
--
-- Records that a tenant opened and finished reading their agreement before
-- signing it, plus a digest of what they read.
--
-- All three columns are additive and nullable: every agreement signed before
-- the read gate existed must remain valid, so absence means "predates the
-- gate", never "did not read".
--
-- NOTE the identifier. This table is "Agreement" -- Prisma's model name with no
-- @@map -- not `agreements`. See the $queryRaw locks in
-- agreement-renewal-service.ts and agreement-renewal-signing-service.ts.

ALTER TABLE "Agreement"
  ADD COLUMN IF NOT EXISTS document_content_hash      TEXT,
  ADD COLUMN IF NOT EXISTS document_opened_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS document_read_completed_at TIMESTAMPTZ;
