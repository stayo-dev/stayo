-- Migration 022: enforce idempotent settlement key from gateway callbacks

-- If duplicates exist, keep the latest row's gateway_txn_id and clear older duplicates
-- so unique index creation is deterministic.
WITH ranked_gateway_ids AS (
    SELECT
        id,
        gateway_txn_id,
        ROW_NUMBER() OVER (
            PARTITION BY gateway_txn_id
            ORDER BY confirmed_at DESC NULLS LAST, created_at DESC, id DESC
        ) AS rn
    FROM payment_attempts
    WHERE gateway_txn_id IS NOT NULL
)
UPDATE payment_attempts pa
SET gateway_txn_id = NULL,
    updated_at = now()
FROM ranked_gateway_ids rg
WHERE pa.id = rg.id
  AND rg.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_gateway_txn_id_unique
    ON payment_attempts(gateway_txn_id)
    WHERE gateway_txn_id IS NOT NULL;
