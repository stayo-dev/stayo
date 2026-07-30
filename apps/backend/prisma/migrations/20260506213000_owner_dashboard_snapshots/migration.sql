CREATE TABLE IF NOT EXISTS public.owner_dashboard_snapshots (
  owner_id             UUID PRIMARY KEY,
  snapshot_month       DATE NOT NULL,
  tenant_count         INTEGER NOT NULL DEFAULT 0,
  active_tenant_count  INTEGER NOT NULL DEFAULT 0,
  total_room_count     INTEGER NOT NULL DEFAULT 0,
  total_capacity       INTEGER NOT NULL DEFAULT 0,
  vacant_beds          INTEGER NOT NULL DEFAULT 0,
  occupancy_rate       INTEGER NOT NULL DEFAULT 0,
  rent_collected_month NUMERIC(12,2) NOT NULL DEFAULT 0,
  expenses_month       NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_dues         NUMERIC(12,2) NOT NULL DEFAULT 0,
  overdue_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  overdue_count        INTEGER NOT NULL DEFAULT 0,
  collection_rate      INTEGER NOT NULL DEFAULT 0,
  monthly_trend        JSONB,
  monthly_trend_months INTEGER NOT NULL DEFAULT 6,
  stats_computed_at    TIMESTAMPTZ,
  monthly_computed_at  TIMESTAMPTZ,
  is_stale             BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_dashboard_snapshots_is_stale
  ON public.owner_dashboard_snapshots(is_stale);
CREATE INDEX IF NOT EXISTS idx_owner_dashboard_snapshots_stats_computed_at
  ON public.owner_dashboard_snapshots(stats_computed_at);
CREATE INDEX IF NOT EXISTS idx_owner_dashboard_snapshots_monthly_computed_at
  ON public.owner_dashboard_snapshots(monthly_computed_at);

