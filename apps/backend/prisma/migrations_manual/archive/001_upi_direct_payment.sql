-- Migration: Add PENDING_VERIFICATION status and unique constraint on gateway_txn_id
-- Run this on your Supabase SQL editor before deploying

-- 1. Add PENDING_VERIFICATION to AttemptStatus enum
ALTER TYPE public."AttemptStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION' AFTER 'PENDING';

-- 2. Add unique constraint on gateway_txn_id (prevents duplicate UPI references)
-- First, clean any existing duplicates (shouldn't have any, but safety first)
-- UPDATE public.payment_attempts SET gateway_txn_id = NULL WHERE gateway_txn_id IS NOT NULL AND id NOT IN (
--   SELECT DISTINCT ON (gateway_txn_id) id FROM public.payment_attempts WHERE gateway_txn_id IS NOT NULL ORDER BY gateway_txn_id, created_at DESC
-- );

-- Add the unique index (allows NULLs, only enforces uniqueness on non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_gateway_txn_id_key" ON public.payment_attempts("gateway_txn_id");
