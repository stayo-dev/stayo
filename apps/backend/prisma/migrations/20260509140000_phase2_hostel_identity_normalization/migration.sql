-- Phase 2: Hostel Identity Normalization
-- SAFE TO RE-RUN: all statements use IF NOT EXISTS / DO NOTHING
-- NO NOT NULL constraints yet — columns are nullable during backfill phase
-- DO NOT apply NOT NULL until dual-read validation confirms <0.1% NULL rate

-- ─── Step 1: Add nullable hostel_id columns ─────────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

ALTER TABLE public.room_allocations
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

ALTER TABLE public.rent_obligations
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

-- ─── Step 2: Add indexes for hostel-scoped queries ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_tenants_hostel_id
  ON public.tenants (hostel_id);

CREATE INDEX IF NOT EXISTS idx_room_allocations_hostel_id
  ON public.room_allocations (hostel_id);

CREATE INDEX IF NOT EXISTS idx_room_allocations_hostel_active
  ON public.room_allocations (hostel_id, is_active);

CREATE INDEX IF NOT EXISTS idx_rent_obligations_hostel_id
  ON public.rent_obligations (hostel_id);

CREATE INDEX IF NOT EXISTS idx_rent_obligations_hostel_status
  ON public.rent_obligations (hostel_id, status);

CREATE INDEX IF NOT EXISTS idx_rent_obligations_hostel_month
  ON public.rent_obligations (hostel_id, rent_month);

-- Also add owner_id index if missing (fixes full-table scan risk from audit)
CREATE INDEX IF NOT EXISTS idx_rent_obligations_owner_id
  ON public.rent_obligations (owner_id);

CREATE INDEX IF NOT EXISTS idx_payments_hostel_id
  ON public.payments (hostel_id);

CREATE INDEX IF NOT EXISTS idx_payments_hostel_date
  ON public.payments (hostel_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_receipts_hostel_id
  ON public.receipts (hostel_id);

CREATE INDEX IF NOT EXISTS idx_receipts_hostel_issued
  ON public.receipts (hostel_id, issued_at);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_hostel_id
  ON public.reminder_logs (hostel_id);

CREATE INDEX IF NOT EXISTS idx_expenses_hostel_id
  ON public.expenses (hostel_id);

CREATE INDEX IF NOT EXISTS idx_expenses_hostel_date
  ON public.expenses (hostel_id, date);

CREATE INDEX IF NOT EXISTS idx_complaints_hostel_id
  ON public.complaints (hostel_id);

-- ─── Step 3: Backfill room_allocations.hostel_id ────────────────────────────
-- Source: room.hostel_id (immutable — rooms don't change hostels)
-- This is the foundation for all subsequent backfills

UPDATE public.room_allocations ra
SET hostel_id = r.hostel_id
FROM public.rooms r
WHERE ra.room_id = r.id
  AND ra.hostel_id IS NULL
  AND r.hostel_id IS NOT NULL;

-- ─── Step 4: Backfill rent_obligations.hostel_id ────────────────────────────
-- Source: allocation.hostel_id (just backfilled above)
-- IMMUTABLE SEMANTIC: this is the hostel at GENERATION time, not current tenant hostel

UPDATE public.rent_obligations o
SET hostel_id = ra.hostel_id
FROM public.room_allocations ra
WHERE o.allocation_id = ra.id
  AND o.hostel_id IS NULL
  AND ra.hostel_id IS NOT NULL;

-- ─── Step 5: Backfill payments.hostel_id ────────────────────────────────────
-- Source: obligation.hostel_id (just backfilled above)
-- IMMUTABLE SEMANTIC: hostel at payment time

UPDATE public.payments p
SET hostel_id = o.hostel_id
FROM public.rent_obligations o
WHERE p.obligation_id = o.id
  AND p.hostel_id IS NULL
  AND o.hostel_id IS NOT NULL;

-- ─── Step 6: Backfill receipts.hostel_id ────────────────────────────────────
-- Source: payment.hostel_id (just backfilled above)
-- IMMUTABLE SEMANTIC: hostel at receipt issuance time

UPDATE public.receipts r
SET hostel_id = p.hostel_id
FROM public.payments p
WHERE r.payment_id = p.id
  AND r.hostel_id IS NULL
  AND p.hostel_id IS NOT NULL;

-- ─── Step 7: Backfill reminder_logs.hostel_id ───────────────────────────────
-- Source: obligation.hostel_id (already backfilled)
-- IMMUTABLE SEMANTIC: hostel at reminder send time

UPDATE public.reminder_logs rl
SET hostel_id = o.hostel_id
FROM public.rent_obligations o
WHERE rl.obligation_id = o.id
  AND rl.hostel_id IS NULL
  AND o.hostel_id IS NOT NULL;

-- ─── Step 8: Backfill tenants.hostel_id ─────────────────────────────────────
-- Source: CURRENT ACTIVE allocation (mutable — represents where tenant is NOW)
-- This is INTENTIONALLY DIFFERENT from financial entity backfills.
-- A transferred tenant gets their new hostel here; old obligations keep old hostel.

UPDATE public.tenants t
SET hostel_id = r.hostel_id
FROM public.room_allocations ra
JOIN public.rooms r ON r.id = ra.room_id
WHERE ra.tenant_id = t.id
  AND ra.is_active = true
  AND t.hostel_id IS NULL
  AND r.hostel_id IS NOT NULL;

-- ─── Validation Queries (run these after applying and report results) ─────────

-- Count NULLs remaining per table (report these before cutover)
SELECT
  'room_allocations'  AS entity, COUNT(*) FILTER (WHERE hostel_id IS NULL) AS null_count, COUNT(*) AS total FROM public.room_allocations
UNION ALL SELECT
  'rent_obligations', COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.rent_obligations
UNION ALL SELECT
  'payments',         COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.payments
UNION ALL SELECT
  'receipts',         COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.receipts
UNION ALL SELECT
  'reminder_logs',    COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.reminder_logs
UNION ALL SELECT
  'tenants',          COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.tenants
ORDER BY entity;
