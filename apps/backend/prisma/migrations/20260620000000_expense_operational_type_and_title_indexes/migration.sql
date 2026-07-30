-- Add operational_type column for HMS-specific expense categorization
-- Values: Operational, Maintenance, Utility, Staff, Emergency
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS operational_type TEXT;

-- Add indexes for title-based intelligence queries (frequent expenses, title summaries)
CREATE INDEX IF NOT EXISTS idx_expenses_owner_title ON expenses (owner_id, title);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_title_date ON expenses (owner_id, title, date DESC);
