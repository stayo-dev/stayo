-- Dashboard-oriented index:
-- speeds owner-scoped month-range obligation reads used by analytics/dashboard APIs.
CREATE INDEX IF NOT EXISTS idx_rent_obligations_owner_month
  ON public.rent_obligations (owner_id, rent_month);

