-- Backfill completed move-outs created before physical_exit_date was enforced.
-- This makes the current release behavior apply to existing records too.

WITH due_move_outs AS (
  SELECT
    id,
    tenant_id,
    COALESCE(physical_exit_date, actual_exit_date, planned_exit_date)::date AS release_date,
    reason::text AS reason,
    reason_text
  FROM move_out_requests
  WHERE status = 'COMPLETED'
    AND room_release_date IS NULL
    AND COALESCE(physical_exit_date, actual_exit_date, planned_exit_date)::date <= CURRENT_DATE
)
UPDATE move_out_requests mor
SET
  physical_exit_date = COALESCE(mor.physical_exit_date, d.release_date),
  actual_exit_date = COALESCE(mor.actual_exit_date, d.release_date),
  room_release_date = d.release_date,
  updated_at = NOW()
FROM due_move_outs d
WHERE mor.id = d.id;

WITH due_move_outs AS (
  SELECT
    id,
    tenant_id,
    COALESCE(physical_exit_date, actual_exit_date, planned_exit_date)::date AS release_date
  FROM move_out_requests
  WHERE status = 'COMPLETED'
    AND room_release_date IS NOT NULL
    AND COALESCE(physical_exit_date, actual_exit_date, planned_exit_date)::date <= CURRENT_DATE
)
UPDATE room_allocations ra
SET
  is_active = FALSE,
  end_date = COALESCE(ra.end_date, d.release_date)
FROM due_move_outs d
WHERE ra.tenant_id = d.tenant_id
  AND ra.is_active = TRUE
  AND ra.end_date IS NULL;

WITH due_move_outs AS (
  SELECT
    tenant_id,
    COALESCE(physical_exit_date, actual_exit_date, planned_exit_date)::date AS release_date,
    reason::text AS reason,
    reason_text
  FROM move_out_requests
  WHERE status = 'COMPLETED'
    AND room_release_date IS NOT NULL
    AND COALESCE(physical_exit_date, actual_exit_date, planned_exit_date)::date <= CURRENT_DATE
)
-- 'LEFT' was this enum's original name for this status; the live database's
-- TenantStatus enum already has it as 'FORMER_TENANT' (renamed outside the
-- tracked Prisma migration history, before this backfill was ever applied —
-- confirmed live 2026-08-15 while resolving a stuck `migrate deploy`). This
-- backfill never ran against any database where 'LEFT' was still the
-- current name, so updating the literal here matches what actually exists
-- rather than rewriting real history.
UPDATE tenants t
SET
  status = 'FORMER_TENANT',
  exit_date = COALESCE(t.exit_date, d.release_date),
  exit_reason = COALESCE(t.exit_reason, d.reason),
  exit_notes = COALESCE(t.exit_notes, d.reason_text),
  updated_at = NOW()
FROM due_move_outs d
WHERE t.id = d.tenant_id
  AND t.status <> 'FORMER_TENANT';

UPDATE rent_obligations ro
SET
  status = 'WAIVED',
  updated_at = NOW()
FROM move_out_requests mor
WHERE mor.tenant_id = ro.tenant_id
  AND mor.status = 'COMPLETED'
  AND mor.room_release_date IS NOT NULL
  AND COALESCE(mor.physical_exit_date, mor.actual_exit_date, mor.planned_exit_date)::date <= CURRENT_DATE
  AND ro.status IN ('PENDING', 'PARTIAL');
