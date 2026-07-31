-- Owner KYC documents (ADR-037). Separate from identification_documents, which
-- is FK'd to tenants and cannot represent an owner. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "owner_documents" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id"  UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "doc_type"    TEXT NOT NULL,
  "file_url"    TEXT NOT NULL,
  "file_id"     TEXT,
  "mime_type"   TEXT NOT NULL,
  "file_size"   INTEGER NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
  "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by" UUID
);

-- One active document per type per owner; re-uploading supersedes by
-- deactivating the previous row rather than overwriting history.
CREATE UNIQUE INDEX IF NOT EXISTS "owner_documents_profile_type_active_key"
  ON "owner_documents" ("profile_id", "doc_type", "is_active");
CREATE INDEX IF NOT EXISTS "owner_documents_profile_id_idx" ON "owner_documents" ("profile_id");
CREATE INDEX IF NOT EXISTS "owner_documents_status_idx" ON "owner_documents" ("status");
