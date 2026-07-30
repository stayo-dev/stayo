-- HMS Operational Integrity Phase
-- Adds forensic migration audits, severity-graded invariant persistence, and immutable hostel snapshots.

CREATE TABLE IF NOT EXISTS public.migration_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_date timestamptz NOT NULL DEFAULT now(),
  artifact_path text NOT NULL,
  orphan_count integer NOT NULL DEFAULT 0,
  mismatch_count integer NOT NULL DEFAULT 0,
  unresolved_records_count integer NOT NULL DEFAULT 0,
  corrected_records_count integer NOT NULL DEFAULT 0,
  corruption_candidates_count integer NOT NULL DEFAULT 0,
  hostel_rollup_validation jsonb,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_audit_runs_audit_date_idx
  ON public.migration_audit_runs (audit_date);

CREATE TABLE IF NOT EXISTS public.financial_invariant_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invariant_type text NOT NULL,
  severity text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  expected_value text,
  actual_value text,
  owner_id uuid,
  hostel_id uuid,
  reconciliation_attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  details jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS financial_invariant_failures_invariant_type_idx
  ON public.financial_invariant_failures (invariant_type);
CREATE INDEX IF NOT EXISTS financial_invariant_failures_severity_idx
  ON public.financial_invariant_failures (severity);
CREATE INDEX IF NOT EXISTS financial_invariant_failures_status_idx
  ON public.financial_invariant_failures (status);
CREATE INDEX IF NOT EXISTS financial_invariant_failures_detected_at_idx
  ON public.financial_invariant_failures (detected_at);
CREATE INDEX IF NOT EXISTS financial_invariant_failures_hostel_id_idx
  ON public.financial_invariant_failures (hostel_id);

CREATE TABLE IF NOT EXISTS public.hostel_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id uuid NOT NULL REFERENCES public.hostels(id),
  snapshot_date date NOT NULL,
  occupancy_rate numeric(7,2) NOT NULL DEFAULT 0,
  active_tenants integer NOT NULL DEFAULT 0,
  expected_revenue numeric(12,2) NOT NULL DEFAULT 0,
  collected_revenue numeric(12,2) NOT NULL DEFAULT 0,
  pending_dues numeric(12,2) NOT NULL DEFAULT 0,
  overdue_count integer NOT NULL DEFAULT 0,
  collection_rate numeric(7,2) NOT NULL DEFAULT 0,
  expenses numeric(12,2) NOT NULL DEFAULT 0,
  profit numeric(12,2) NOT NULL DEFAULT 0,
  source_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hostel_daily_snapshots_unique UNIQUE (hostel_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS hostel_daily_snapshots_snapshot_date_idx
  ON public.hostel_daily_snapshots (snapshot_date);

-- Immutability guard: snapshots are append-only/reconciliation-safe.
CREATE OR REPLACE FUNCTION public.prevent_hostel_daily_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'hostel_daily_snapshots are immutable; insert a reconciliation record or a new snapshot date instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_hostel_daily_snapshot_update ON public.hostel_daily_snapshots;
CREATE TRIGGER trg_prevent_hostel_daily_snapshot_update
BEFORE UPDATE ON public.hostel_daily_snapshots
FOR EACH ROW EXECUTE FUNCTION public.prevent_hostel_daily_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_prevent_hostel_daily_snapshot_delete ON public.hostel_daily_snapshots;
CREATE TRIGGER trg_prevent_hostel_daily_snapshot_delete
BEFORE DELETE ON public.hostel_daily_snapshots
FOR EACH ROW EXECUTE FUNCTION public.prevent_hostel_daily_snapshot_mutation();
