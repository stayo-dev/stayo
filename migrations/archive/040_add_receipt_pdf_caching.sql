-- Migration 040: Add receipt PDF caching and URL storage
-- Adds receipt_pdf_url to store generated PDF in Supabase storage
-- Enables fast delivery without regenerating PDFs on every download

-- Add receipt_pdf_url column if not exists
-- Stores the path/URL to the cached PDF in Supabase storage
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS receipt_pdf_url VARCHAR(1024);

-- Add column to track receipt PDF generation status
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS receipt_pdf_generated_at TIMESTAMP WITH TIME ZONE;

-- Create index for fast lookup of uncached receipts
CREATE INDEX IF NOT EXISTS idx_payments_receipt_pdf_status
ON payments (owner_id, receipt_pdf_generated_at)
WHERE receipt_pdf_url IS NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN payments.receipt_pdf_url IS 
    'URL to cached PDF receipt in Supabase storage. Format: receipts/YYYY-MM/owner_id/payment_id.pdf';

COMMENT ON COLUMN payments.receipt_pdf_generated_at IS 
    'Timestamp when PDF was generated and cached. Used to track cache status.';
