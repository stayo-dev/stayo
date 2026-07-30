-- Migration: receipt_pdf_cache
-- Adds a cached PDF URL and template version to the receipts table.
-- Mirrors the existing invoice_pdf_url / invoice_template_version pattern.
--
-- Purpose:
--   Allow the Puppeteer receipt PDF (GET /payments/:id/receipt) to be stored
--   and reused on subsequent requests instead of re-rendering from scratch.
--   A version column ensures stale PDFs are regenerated when the template changes.
--
-- Safety:
--   Both columns are nullable. Existing rows default to NULL (no cached PDF).
--   Service will generate on demand and populate on first render.
--   No data loss risk. Fully backwards-compatible.

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS receipt_pdf_url          TEXT,
  ADD COLUMN IF NOT EXISTS receipt_template_version INT;
