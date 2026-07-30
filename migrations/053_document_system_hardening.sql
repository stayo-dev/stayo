-- ============================================================
-- 053 Document System Hardening
-- ============================================================

-- 1. New audit / storage columns on identification_documents
ALTER TABLE identification_documents
  ADD COLUMN IF NOT EXISTS file_path   TEXT,
  ADD COLUMN IF NOT EXISTS mime_type   TEXT,
  ADD COLUMN IF NOT EXISTS file_size   INTEGER,
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reject_ip   TEXT;

-- 2. Back-fill is_active for existing rows
UPDATE identification_documents SET is_active = TRUE WHERE is_active IS NULL;

-- 3. Mark existing base64 blobs as inactive (legacy data)
UPDATE identification_documents
   SET is_active = FALSE
 WHERE file_url LIKE 'data:%';

-- 4. One-active-doc-per-tenant-per-type partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS udx_id_doc_one_active
  ON identification_documents (tenant_id, doc_type)
  WHERE is_active = TRUE;

-- 5. Additional performance index
CREATE INDEX IF NOT EXISTS idx_id_doc_tenant_type_active
  ON identification_documents (tenant_id, doc_type, is_active);

-- 6. Plan feature columns
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS profile_photo         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS document_verification BOOLEAN NOT NULL DEFAULT FALSE;

-- 7. Set plan flags (matches seed.ts values)
UPDATE plans SET profile_photo = FALSE, document_verification = FALSE WHERE id = 'FREE';
UPDATE plans SET profile_photo = TRUE,  document_verification = FALSE WHERE id = 'STARTER';
UPDATE plans SET profile_photo = TRUE,  document_verification = TRUE  WHERE id = 'GROWTH';
UPDATE plans SET profile_photo = TRUE,  document_verification = TRUE  WHERE id = 'BUSINESS';
UPDATE plans SET profile_photo = TRUE,  document_verification = TRUE  WHERE id = 'SCALE';
