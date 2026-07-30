-- Phase 1: durable ledger for rent generation reliability.
-- Forward-only and safe to re-run manually in Supabase.

CREATE TABLE IF NOT EXISTS public.rent_generation_ledgers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL,
  hostel_id       UUID NOT NULL,
  rent_month      DATE NOT NULL,
  obligation_type TEXT NOT NULL,
  status          TEXT NOT NULL,
  trigger_type    TEXT,
  generated_by    UUID,
  created_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  failure_reason  TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT rent_generation_ledgers_status_check
    CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED', 'SKIPPED')),
  CONSTRAINT rent_generation_ledgers_scope_key
    UNIQUE (owner_id, hostel_id, rent_month, obligation_type)
);

CREATE INDEX IF NOT EXISTS idx_rent_generation_ledgers_month_status
  ON public.rent_generation_ledgers (rent_month, status);

CREATE INDEX IF NOT EXISTS idx_rent_generation_ledgers_owner_month
  ON public.rent_generation_ledgers (owner_id, rent_month);

CREATE INDEX IF NOT EXISTS idx_rent_generation_ledgers_hostel_month
  ON public.rent_generation_ledgers (hostel_id, rent_month);

-- Backfill completed ledger entries for existing obligations that can be
-- safely tied to a hostel through allocation -> room -> hostel.
INSERT INTO public.rent_generation_ledgers (
  owner_id,
  hostel_id,
  rent_month,
  obligation_type,
  status,
  trigger_type,
  created_count,
  skipped_count,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  o.owner_id,
  r.hostel_id,
  o.rent_month,
  COALESCE(o.obligation_type, 'RENT') AS obligation_type,
  'COMPLETED' AS status,
  'backfill' AS trigger_type,
  COUNT(*)::INTEGER AS created_count,
  0 AS skipped_count,
  MIN(o.created_at) AS started_at,
  MAX(o.created_at) AS completed_at,
  NOW() AS created_at,
  NOW() AS updated_at
FROM public.rent_obligations o
JOIN public.room_allocations ra ON ra.id = o.allocation_id
JOIN public.rooms r ON r.id = ra.room_id
WHERE o.owner_id IS NOT NULL
  AND o.allocation_id IS NOT NULL
  AND r.hostel_id IS NOT NULL
GROUP BY o.owner_id, r.hostel_id, o.rent_month, COALESCE(o.obligation_type, 'RENT')
ON CONFLICT (owner_id, hostel_id, rent_month, obligation_type) DO NOTHING;
