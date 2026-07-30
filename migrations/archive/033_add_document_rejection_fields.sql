-- Add rejection metadata for tenant identification documents
ALTER TABLE identification_documents
    ADD COLUMN IF NOT EXISTS rejected BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_identification_documents_rejected
    ON identification_documents(rejected);
