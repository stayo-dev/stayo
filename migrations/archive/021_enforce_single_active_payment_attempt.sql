-- Migration 021: enforce a single active payment attempt per obligation

-- Keep only the newest active attempt for each obligation and expire older ones.
WITH ranked_attempts AS (
    SELECT
        id,
        obligation_id,
        status,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY obligation_id
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM payment_attempts
    WHERE status IN ('CREATED', 'PENDING')
)
UPDATE payment_attempts pa
SET status = 'EXPIRED',
    updated_at = now()
FROM ranked_attempts ra
WHERE pa.id = ra.id
  AND ra.rn > 1;

-- DB-level safeguard: at most one active (CREATED/PENDING) attempt per obligation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_one_active_per_obligation
    ON payment_attempts(obligation_id)
    WHERE status IN ('CREATED', 'PENDING');
