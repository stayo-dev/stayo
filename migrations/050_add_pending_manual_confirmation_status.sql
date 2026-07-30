-- Migration 050: Add PENDING_MANUAL_CONFIRMATION to AttemptStatus enum
-- Used when a UPI payment succeeds at the gateway but the owner's plan does
-- not include automation — payment parks here until owner manually confirms.

ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'PENDING_MANUAL_CONFIRMATION';
