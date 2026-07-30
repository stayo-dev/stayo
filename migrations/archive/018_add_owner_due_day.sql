-- Migration 018: Add Owner Due Day
-- This adds a setting for owners to control when rent is due.

DO $$ 
BEGIN
    -- 1. Add due_day column to profiles (only relevant for owners)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='due_day') THEN
        ALTER TABLE profiles ADD COLUMN due_day INTEGER DEFAULT 10 CHECK (due_day >= 1 AND due_day <= 28);
    END IF;
END $$;
