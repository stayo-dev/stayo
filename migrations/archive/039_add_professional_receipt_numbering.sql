-- Migration 039: Add professional receipt numbering to payments
-- Adds receipt_number column to track sequential receipt numbers per hostel per month
-- Enables REC-YYYY-MM-XXXXX format with proper sequencing

-- Add receipt_number column if not exists
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS receipt_number INTEGER;

-- Create unique index to enforce unique receipt numbers per owner per month
-- Using index instead of constraint because it supports DATE_TRUNC expression
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_receipt_per_owner_month
ON payments (owner_id, DATE_TRUNC('month', created_at AT TIME ZONE 'Asia/Kolkata'), receipt_number)
WHERE receipt_number IS NOT NULL;

-- Create index for faster querying by owner and month
CREATE INDEX IF NOT EXISTS idx_payments_owner_month_receipt
ON payments (owner_id, DATE_TRUNC('month', created_at AT TIME ZONE 'Asia/Kolkata'), receipt_number);

-- Add sequence generator function to auto-assign receipt numbers
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TRIGGER AS $$
DECLARE
    v_month_start TIMESTAMP;
    v_max_receipt INTEGER;
BEGIN
    -- Get the start of the month for the payment
    v_month_start := DATE_TRUNC('month', NEW.created_at AT TIME ZONE 'Asia/Kolkata');
    
        -- Find the maximum receipt_number for this owner in this month
    SELECT COALESCE(MAX(receipt_number), 0) + 1
    INTO v_max_receipt
    FROM payments
        WHERE owner_id = NEW.owner_id 
      AND DATE_TRUNC('month', created_at AT TIME ZONE 'Asia/Kolkata') = v_month_start
      AND id != NEW.id;  -- Exclude current row for updates
    
    -- Set the receipt_number
    NEW.receipt_number := v_max_receipt;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old trigger if exists
DROP TRIGGER IF EXISTS trg_generate_receipt_number ON payments;

-- Create trigger to auto-generate receipt numbers on insert/update
CREATE TRIGGER trg_generate_receipt_number
BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION generate_receipt_number();

-- Backfill receipt_number for existing payments (group by owner and month)
WITH payment_ranking AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY owner_id, DATE_TRUNC('month', created_at AT TIME ZONE 'Asia/Kolkata')
            ORDER BY created_at ASC, id ASC
        ) as new_receipt_number
    FROM payments
    WHERE receipt_number IS NULL
)
UPDATE payments p
SET receipt_number = pr.new_receipt_number
FROM payment_ranking pr
WHERE p.id = pr.id;

-- Add comment explaining the column
COMMENT ON COLUMN payments.receipt_number IS 
    'Sequential receipt number per hostel per month. Used for professional receipt numbering: REC-YYYY-MM-XXXXX';
