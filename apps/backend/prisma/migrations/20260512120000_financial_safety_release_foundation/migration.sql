-- Financial Safety Release foundation.
-- Additive-only: new nullable columns, new audit/event/anomaly tables, and indexes.

ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS payment_domain TEXT,
  ADD COLUMN IF NOT EXISTS scope_type TEXT,
  ADD COLUMN IF NOT EXISTS flow_type TEXT,
  ADD COLUMN IF NOT EXISTS merchant_context_type TEXT,
  ADD COLUMN IF NOT EXISTS merchant_context_id TEXT,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS merchant_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference_id TEXT;

UPDATE public.payment_attempts
SET merchant_transaction_id = merchant_txn_id
WHERE merchant_transaction_id IS NULL
  AND merchant_txn_id IS NOT NULL;

UPDATE public.payment_attempts
SET
  payment_domain = CASE
    WHEN invoice_id IS NOT NULL OR payment_type = 'ADDON' THEN 'PLATFORM_BILLING'
    ELSE 'RENT_COLLECTION'
  END,
  scope_type = CASE
    WHEN invoice_id IS NOT NULL OR payment_type = 'ADDON' THEN 'PLATFORM'
    ELSE 'HOSTEL'
  END,
  flow_type = CASE
    WHEN invoice_id IS NOT NULL THEN 'SUBSCRIPTION'
    WHEN payment_type = 'ADDON' THEN 'ADDON'
    WHEN payment_type = 'ADVANCE' THEN 'ADVANCE'
    ELSE 'RENT'
  END,
  merchant_context_type = CASE
    WHEN invoice_id IS NOT NULL OR payment_type = 'ADDON' THEN 'HMS_PLATFORM'
    ELSE 'OWNER_HOSTEL'
  END,
  merchant_context_id = CASE
    WHEN invoice_id IS NOT NULL OR payment_type = 'ADDON' THEN 'HMS_PLATFORM'
    ELSE hostel_id::text
  END,
  settlement_status = CASE
    WHEN status = 'SUCCESS' THEN 'SETTLED'
    WHEN status IN ('FAILED','EXPIRED','CANCELLED') THEN 'NOT_APPLICABLE'
    ELSE 'NOT_SETTLED'
  END,
  settled_at = CASE
    WHEN status = 'SUCCESS' AND settled_at IS NULL THEN confirmed_at
    ELSE settled_at
  END
WHERE payment_domain IS NULL
   OR scope_type IS NULL
   OR flow_type IS NULL
   OR merchant_context_type IS NULL
   OR settlement_status IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_merchant_transaction_id_key
  ON public.payment_attempts(merchant_transaction_id)
  WHERE merchant_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_domain
  ON public.payment_attempts(payment_domain);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_flow_type
  ON public.payment_attempts(flow_type);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_settlement_status
  ON public.payment_attempts(settlement_status);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_merchant_context
  ON public.payment_attempts(merchant_context_type, merchant_context_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_transaction
  ON public.payment_attempts(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_order
  ON public.payment_attempts(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_attempts_settled_requires_success'
  ) THEN
    ALTER TABLE public.payment_attempts
      ADD CONSTRAINT payment_attempts_settled_requires_success
      CHECK (settlement_status IS DISTINCT FROM 'SETTLED' OR status = 'SUCCESS')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_attempts_rent_collection_requires_hostel_scope'
  ) THEN
    ALTER TABLE public.payment_attempts
      ADD CONSTRAINT payment_attempts_rent_collection_requires_hostel_scope
      CHECK (
        payment_domain IS DISTINCT FROM 'RENT_COLLECTION'
        OR flow_type NOT IN ('RENT', 'ADVANCE', 'MANUAL_UPI_REFERENCE')
        OR hostel_id IS NOT NULL
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_attempts_platform_billing_no_hostel_scope'
  ) THEN
    ALTER TABLE public.payment_attempts
      ADD CONSTRAINT payment_attempts_platform_billing_no_hostel_scope
      CHECK (
        payment_domain IS DISTINCT FROM 'PLATFORM_BILLING'
        OR scope_type = 'PLATFORM'
      )
      NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_payment_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_LEDGER: settled payment ledger rows cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_payment_ledger_update ON public.payments;
CREATE TRIGGER trg_prevent_payment_ledger_update
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.prevent_payment_ledger_mutation();

DROP TRIGGER IF EXISTS trg_prevent_payment_ledger_delete ON public.payments;
CREATE TRIGGER trg_prevent_payment_ledger_delete
BEFORE DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.prevent_payment_ledger_mutation();

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  payment_domain TEXT,
  flow_type TEXT,
  merchant_context_type TEXT,
  merchant_context_id TEXT,
  merchant_transaction_id TEXT,
  provider_transaction_id TEXT,
  provider_order_id TEXT,
  provider_reference_id TEXT,
  event_hash TEXT NOT NULL UNIQUE,
  raw_payload JSONB NOT NULL,
  headers_redacted JSONB,
  received_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
  processing_result JSONB,
  payment_attempt_id UUID,
  operational_owner_id UUID,
  financial_owner_id UUID,
  hostel_id UUID,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  signature_algorithm TEXT,
  signature_failure_reason TEXT,
  error_message TEXT,
  processed_at TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_provider_received
  ON public.payment_webhook_events(provider, received_at);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_attempt
  ON public.payment_webhook_events(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_hostel_received
  ON public.payment_webhook_events(hostel_id, received_at);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_owner_received
  ON public.payment_webhook_events(operational_owner_id, received_at);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_status
  ON public.payment_webhook_events(processing_status);

CREATE TABLE IF NOT EXISTS public.payment_provider_verification_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  payment_domain TEXT,
  flow_type TEXT,
  source TEXT NOT NULL,
  payment_attempt_id UUID,
  webhook_event_id UUID,
  reconciliation_run_id UUID,
  merchant_transaction_id TEXT,
  provider_transaction_id TEXT,
  provider_order_id TEXT,
  provider_reference_id TEXT,
  provider_status TEXT,
  normalized_status TEXT NOT NULL,
  amount NUMERIC(10, 2),
  raw_response JSONB,
  raw_response_hash TEXT NOT NULL,
  verified_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  operational_owner_id UUID,
  financial_owner_id UUID,
  hostel_id UUID
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_verification_snapshots_attempt_verified
  ON public.payment_provider_verification_snapshots(payment_attempt_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_payment_provider_verification_snapshots_hostel_verified
  ON public.payment_provider_verification_snapshots(hostel_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_payment_provider_verification_snapshots_provider_verified
  ON public.payment_provider_verification_snapshots(provider, verified_at);
CREATE INDEX IF NOT EXISTS idx_payment_provider_verification_snapshots_hash
  ON public.payment_provider_verification_snapshots(raw_response_hash);

CREATE TABLE IF NOT EXISTS public.payment_attempt_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id UUID NOT NULL,
  transition_sequence INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  source TEXT NOT NULL,
  actor_id UUID,
  operational_owner_id UUID,
  financial_owner_id UUID,
  hostel_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  UNIQUE(payment_attempt_id, transition_sequence)
);

CREATE INDEX IF NOT EXISTS idx_payment_attempt_status_events_attempt_created
  ON public.payment_attempt_status_events(payment_attempt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_attempt_status_events_hostel_created
  ON public.payment_attempt_status_events(hostel_id, created_at);

CREATE TABLE IF NOT EXISTS public.payment_operational_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  payment_domain TEXT,
  flow_type TEXT,
  payment_attempt_id UUID,
  payment_id UUID,
  webhook_event_id UUID,
  reconciliation_run_id UUID,
  operational_owner_id UUID,
  financial_owner_id UUID,
  hostel_id UUID,
  status TEXT NOT NULL DEFAULT 'OPEN',
  detected_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ(6),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_payment_operational_anomalies_type_status
  ON public.payment_operational_anomalies(anomaly_type, status);
CREATE INDEX IF NOT EXISTS idx_payment_operational_anomalies_attempt
  ON public.payment_operational_anomalies(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_payment_operational_anomalies_hostel_detected
  ON public.payment_operational_anomalies(hostel_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_payment_operational_anomalies_owner_detected
  ON public.payment_operational_anomalies(operational_owner_id, detected_at);

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_domain TEXT NOT NULL,
  scope_type TEXT,
  operational_owner_id UUID,
  financial_owner_id UUID,
  hostel_id UUID,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ(6),
  summary JSONB,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_runs_domain_started
  ON public.payment_reconciliation_runs(payment_domain, started_at);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_runs_hostel_started
  ON public.payment_reconciliation_runs(hostel_id, started_at);

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id UUID NOT NULL,
  payment_attempt_id UUID,
  payment_id UUID,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  operational_owner_id UUID,
  financial_owner_id UUID,
  hostel_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_items_run
  ON public.payment_reconciliation_items(reconciliation_run_id);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_items_attempt
  ON public.payment_reconciliation_items(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_items_hostel_created
  ON public.payment_reconciliation_items(hostel_id, created_at);
