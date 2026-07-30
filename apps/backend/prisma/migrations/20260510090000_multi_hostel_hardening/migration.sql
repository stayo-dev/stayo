-- Multi-hostel hardening migration.
-- Apply only after `scripts/backfill_hostel_ids.ts` reports zero unresolved
-- operational rows in the target environment.

ALTER TABLE public.tenants ALTER COLUMN hostel_id SET NOT NULL;
ALTER TABLE public.room_allocations ALTER COLUMN hostel_id SET NOT NULL;
ALTER TABLE public.rent_obligations ALTER COLUMN hostel_id SET NOT NULL;
ALTER TABLE public.payments ALTER COLUMN hostel_id SET NOT NULL;
ALTER TABLE public.receipts ALTER COLUMN hostel_id SET NOT NULL;
-- Single-owner architecture supports business-level expenses that are not tied
-- to a hostel. Later migrations also explicitly keep expenses.hostel_id
-- nullable, so do not enforce NOT NULL here.
ALTER TABLE public.complaints ALTER COLUMN hostel_id SET NOT NULL;
ALTER TABLE public.reminder_logs ALTER COLUMN hostel_id SET NOT NULL;

ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS hostel_id UUID REFERENCES public.hostels(id);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_hostel_room_no_active_unique
  ON public.rooms(hostel_id, room_no)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS receipts_hostel_receipt_number_unique
  ON public.receipts(hostel_id, receipt_number);

CREATE INDEX IF NOT EXISTS rent_obligations_hostel_due_date_idx
  ON public.rent_obligations(hostel_id, due_date);

CREATE INDEX IF NOT EXISTS payments_hostel_created_at_idx
  ON public.payments(hostel_id, created_at);

CREATE INDEX IF NOT EXISTS expenses_hostel_created_at_idx
  ON public.expenses(hostel_id, created_at);

ALTER TABLE public.payments
  ADD CONSTRAINT payments_obligation_hostel_match
  CHECK (hostel_id IS NOT NULL);

ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_payment_hostel_required
  CHECK (hostel_id IS NOT NULL);
