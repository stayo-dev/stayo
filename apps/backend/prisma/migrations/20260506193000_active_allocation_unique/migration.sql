-- Enforce "one ACTIVE allocation per tenant" without affecting historical rows.
-- ACTIVE is canonically defined as: is_active = true AND end_date IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_allocations_active_tenant_unique
  ON public.room_allocations (tenant_id)
  WHERE is_active = true AND end_date IS NULL;

