-- Move-Out Status Reconciliation
-- Add canonical physical/financial lifecycle statuses.
--
-- Existing live enum values remain readable for compatibility:
-- REQUESTED, SETTLEMENT_PENDING, APPROVED, VACATED, COMPLETED, REJECTED.
-- New runtime writes should use SETTLEMENT_APPROVED, PHYSICALLY_VACATED,
-- and SETTLEMENT_PENDING_PAYMENT instead of APPROVED/VACATED.

ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'SETTLEMENT_APPROVED';
ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'PHYSICALLY_VACATED';
ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'SETTLEMENT_PENDING_PAYMENT';
