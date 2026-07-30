import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type Check = {
  id: string;
  severity: Severity;
  description: string;
  sql: string;
};

type Finding = {
  check_id: string;
  severity: Severity;
  description: string;
  entity_id: string | null;
  owner_id: string | null;
  hostel_id: string | null;
  expected: string | null;
  actual: string | null;
  metadata: Record<string, any>;
};

const checks: Check[] = [
  {
    id: "SUCCESS_RENT_ATTEMPT_HAS_LEDGER",
    severity: "CRITICAL",
    description: "A successful RentCollection rent attempt must have at least one immutable Payment ledger row.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'payment ledger row' AS expected,
             'none' AS actual,
             jsonb_build_object('merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id), 'status', pa.status) AS metadata
      FROM payment_attempts pa
      WHERE pa.status = 'SUCCESS'
        AND COALESCE(pa.payment_domain, 'RENT_COLLECTION') = 'RENT_COLLECTION'
        AND COALESCE(pa.flow_type, pa.payment_type, 'RENT') = 'RENT'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.payment_attempt_id = pa.id)
      LIMIT 1000
    `,
  },
  {
    id: "SETTLED_ATTEMPT_IS_SUCCESS",
    severity: "CRITICAL",
    description: "An attempt marked SETTLED must be terminal SUCCESS.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'SUCCESS' AS expected,
             pa.status AS actual,
             jsonb_build_object('settlement_status', pa.settlement_status, 'merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id)) AS metadata
      FROM payment_attempts pa
      WHERE pa.settlement_status = 'SETTLED'
        AND pa.status <> 'SUCCESS'
      LIMIT 1000
    `,
  },
  {
    id: "PLATFORM_BILLING_DOES_NOT_TOUCH_RENT_LEDGER",
    severity: "CRITICAL",
    description: "PlatformBilling attempts must not reference rent obligations or create rent Payment rows.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'no rent obligation/payment links' AS expected,
             'rent-linked platform attempt' AS actual,
             jsonb_build_object('obligation_id', pa.obligation_id, 'payment_count', COUNT(p.id)) AS metadata
      FROM payment_attempts pa
      LEFT JOIN payments p ON p.payment_attempt_id = pa.id
      LEFT JOIN payment_attempt_obligations pao ON pao.payment_attempt_id = pa.id
      WHERE pa.payment_domain = 'PLATFORM_BILLING'
        AND (pa.obligation_id IS NOT NULL OR p.id IS NOT NULL OR pao.id IS NOT NULL)
      GROUP BY pa.id
      LIMIT 1000
    `,
  },
  {
    id: "PLATFORM_BILLING_USES_HMS_CONTEXT",
    severity: "CRITICAL",
    description: "PlatformBilling attempts must use HMS platform merchant context and must not require hostel scope.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'HMS_PLATFORM context with null hostel_id' AS expected,
             CONCAT(COALESCE(pa.merchant_context_type, 'null'), ', hostel=', COALESCE(pa.hostel_id::text, 'null')) AS actual,
             jsonb_build_object('flow_type', pa.flow_type, 'scope_type', pa.scope_type, 'merchant_context_id', pa.merchant_context_id) AS metadata
      FROM payment_attempts pa
      WHERE (pa.payment_domain = 'PLATFORM_BILLING' OR pa.flow_type = 'SUBSCRIPTION')
        AND (
          pa.merchant_context_type IS DISTINCT FROM 'HMS_PLATFORM'
          OR pa.scope_type IS DISTINCT FROM 'PLATFORM'
          OR pa.hostel_id IS NOT NULL
        )
      LIMIT 1000
    `,
  },
  {
    id: "PLATFORM_BILLING_HAS_NO_RENT_OBLIGATION_LINKAGE",
    severity: "CRITICAL",
    description: "PlatformBilling attempts must not link to rent obligations through legacy fields or junction rows.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'no obligation linkage' AS expected,
             'rent obligation linkage present' AS actual,
             jsonb_build_object('obligation_id', pa.obligation_id, 'linked_obligations', COUNT(pao.id)) AS metadata
      FROM payment_attempts pa
      LEFT JOIN payment_attempt_obligations pao ON pao.payment_attempt_id = pa.id
      WHERE (pa.payment_domain = 'PLATFORM_BILLING' OR pa.flow_type = 'SUBSCRIPTION')
        AND (pa.obligation_id IS NOT NULL OR pao.id IS NOT NULL)
      GROUP BY pa.id
      LIMIT 1000
    `,
  },
  {
    id: "RENT_COLLECTION_HAS_HOSTEL_SCOPE",
    severity: "CRITICAL",
    description: "Active RentCollection operational attempts must carry hostel_id.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'non-null hostel_id' AS expected,
             'null hostel_id' AS actual,
             jsonb_build_object('status', pa.status, 'flow_type', pa.flow_type, 'payment_type', pa.payment_type) AS metadata
      FROM payment_attempts pa
      WHERE COALESCE(pa.payment_domain, 'RENT_COLLECTION') = 'RENT_COLLECTION'
        AND COALESCE(pa.flow_type, pa.payment_type, 'RENT') IN ('RENT', 'ADVANCE', 'DEPOSIT', 'FUTURE_RENT_CREDIT', 'SECURITY_DEPOSIT', 'MANUAL_UPI_REFERENCE')
        AND pa.status NOT IN ('FAILED', 'EXPIRED', 'CANCELLED')
        AND pa.hostel_id IS NULL
      LIMIT 1000
    `,
  },
  {
    id: "RENT_COLLECTION_NEVER_USES_HMS_PLATFORM_MERCHANT",
    severity: "CRITICAL",
    description: "RentCollection attempts must never resolve to the HMS platform billing merchant context.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'HMS_TREASURY merchant context with hostel scope' AS expected,
             COALESCE(pa.merchant_context_type, 'null') AS actual,
             jsonb_build_object('status', pa.status, 'flow_type', pa.flow_type, 'merchant_context_id', pa.merchant_context_id, 'merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id)) AS metadata
      FROM payment_attempts pa
      WHERE COALESCE(pa.payment_domain, 'RENT_COLLECTION') = 'RENT_COLLECTION'
        AND COALESCE(pa.flow_type, pa.payment_type, 'RENT') IN ('RENT', 'ADVANCE', 'DEPOSIT', 'FUTURE_RENT_CREDIT', 'SECURITY_DEPOSIT', 'MANUAL_UPI_REFERENCE')
        AND (
          pa.merchant_context_type = 'HMS_PLATFORM'
          OR pa.scope_type = 'PLATFORM'
          OR pa.hostel_id IS NULL
        )
      LIMIT 1000
    `,
  },

  {
    id: "PAYMENT_HOSTEL_MATCHES_OBLIGATION",
    severity: "CRITICAL",
    description: "Payment ledger hostel_id must match the rent obligation hostel_id.",
    sql: `
      SELECT p.id, p.owner_id, p.hostel_id,
             o.hostel_id::text AS expected,
             p.hostel_id::text AS actual,
             jsonb_build_object('obligation_id', p.obligation_id, 'payment_attempt_id', p.payment_attempt_id) AS metadata
      FROM payments p
      JOIN rent_obligations o ON o.id = p.obligation_id
      WHERE p.hostel_id IS DISTINCT FROM o.hostel_id
      LIMIT 1000
    `,
  },
  {
    id: "PAYMENT_ATTEMPT_HOSTEL_MATCHES_PAYMENT",
    severity: "CRITICAL",
    description: "Payment rows created by an attempt must remain inside the attempt hostel scope.",
    sql: `
      SELECT p.id, p.owner_id, p.hostel_id,
             pa.hostel_id::text AS expected,
             p.hostel_id::text AS actual,
             jsonb_build_object('payment_attempt_id', pa.id, 'merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id)) AS metadata
      FROM payments p
      JOIN payment_attempts pa ON pa.id = p.payment_attempt_id
      WHERE pa.hostel_id IS NOT NULL
        AND p.hostel_id IS DISTINCT FROM pa.hostel_id
      LIMIT 1000
    `,
  },
  {
    id: "NO_OBLIGATION_OVERPAYMENT",
    severity: "CRITICAL",
    description: "Immutable Payment rows must not settle more than the obligation amount.",
    sql: `
      WITH paid AS (
        SELECT o.id, o.owner_id, o.hostel_id, o.amount, COALESCE(SUM(p.amount_paid), 0) AS paid
        FROM rent_obligations o
        LEFT JOIN payments p ON p.obligation_id = o.id
        GROUP BY o.id
      )
      SELECT id, owner_id, hostel_id,
             amount::text AS expected,
             paid::text AS actual,
             jsonb_build_object('overpaid_by', (paid - amount)::text) AS metadata
      FROM paid
      WHERE paid > amount + 0.01
      LIMIT 1000
    `,
  },
  {
    id: "PAYMENT_AMOUNT_POSITIVE",
    severity: "CRITICAL",
    description: "Settled Payment ledger rows must have positive amounts.",
    sql: `
      SELECT p.id, p.owner_id, p.hostel_id,
             'amount_paid > 0' AS expected,
             p.amount_paid::text AS actual,
             jsonb_build_object('payment_attempt_id', p.payment_attempt_id) AS metadata
      FROM payments p
      WHERE p.amount_paid <= 0
      LIMIT 1000
    `,
  },
  {
    id: "PAYMENT_IDEMPOTENCY_KEY_UNIQUE_FOR_ATTEMPT_OBLIGATION",
    severity: "CRITICAL",
    description: "A payment attempt must not create duplicate ledger rows for the same obligation.",
    sql: `
      SELECT MIN(p.id::text)::uuid AS id, MIN(p.owner_id::text)::uuid AS owner_id, MIN(p.hostel_id::text)::uuid AS hostel_id,
             'one payment per attempt+obligation' AS expected,
             COUNT(*)::text AS actual,
             jsonb_build_object('payment_attempt_id', p.payment_attempt_id, 'obligation_id', p.obligation_id) AS metadata
      FROM payments p
      WHERE p.payment_attempt_id IS NOT NULL
      GROUP BY p.payment_attempt_id, p.obligation_id
      HAVING COUNT(*) > 1
      LIMIT 1000
    `,
  },
  {
    id: "ORPHAN_LEDGER_ATTEMPT_NOT_SUCCESS",
    severity: "HIGH",
    description: "Ledger exists for an attempt that is not SUCCESS after the settlement recovery window.",
    sql: `
      SELECT p.id, p.owner_id, p.hostel_id,
             'attempt SUCCESS' AS expected,
             pa.status AS actual,
             jsonb_build_object('payment_attempt_id', pa.id, 'merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id)) AS metadata
      FROM payments p
      JOIN payment_attempts pa ON pa.id = p.payment_attempt_id
      WHERE pa.status <> 'SUCCESS'
        AND p.created_at < NOW() - INTERVAL '5 minutes'
      LIMIT 1000
    `,
  },
  {
    id: "RECEIPT_EXISTS_FOR_PAYMENT",
    severity: "HIGH",
    description: "Every settled payment older than the async receipt window should have a receipt.",
    sql: `
      SELECT p.id, p.owner_id, p.hostel_id,
             'receipt row' AS expected,
             'none' AS actual,
             jsonb_build_object('payment_attempt_id', p.payment_attempt_id, 'created_at', p.created_at) AS metadata
      FROM payments p
      LEFT JOIN receipts r ON r.payment_id = p.id
      WHERE r.id IS NULL
        AND p.created_at < NOW() - INTERVAL '5 minutes'
      LIMIT 1000
    `,
  },
  {
    id: "STATUS_SEQUENCE_GAP_FREE",
    severity: "HIGH",
    description: "PaymentAttemptStatusEvent transition_sequence must be gap-free and unique per attempt.",
    sql: `
      SELECT payment_attempt_id AS id, NULL::uuid AS owner_id, NULL::uuid AS hostel_id,
             'min=1, count=max, distinct=count' AS expected,
             CONCAT('min=', MIN(transition_sequence), ', max=', MAX(transition_sequence), ', count=', COUNT(*), ', distinct=', COUNT(DISTINCT transition_sequence)) AS actual,
             jsonb_build_object('payment_attempt_id', payment_attempt_id) AS metadata
      FROM payment_attempt_status_events
      GROUP BY payment_attempt_id
      HAVING MIN(transition_sequence) <> 1
         OR MAX(transition_sequence) <> COUNT(*)
         OR COUNT(DISTINCT transition_sequence) <> COUNT(*)
      LIMIT 1000
    `,
  },
  {
    id: "DUPLICATE_PROVIDER_TRANSACTION_ID",
    severity: "HIGH",
    description: "Provider transaction ids must not collide inside the same provider/domain.",
    sql: `
      SELECT MIN(id::text)::uuid AS id, MIN(owner_id::text)::uuid AS owner_id, MIN(hostel_id::text)::uuid AS hostel_id,
             'unique provider_transaction_id per provider/domain' AS expected,
             COUNT(*)::text AS actual,
             jsonb_build_object('provider', provider, 'payment_domain', payment_domain, 'provider_transaction_id', provider_transaction_id) AS metadata
      FROM payment_attempts
      WHERE provider_transaction_id IS NOT NULL
      GROUP BY provider, payment_domain, provider_transaction_id
      HAVING COUNT(*) > 1
      LIMIT 1000
    `,
  },
  {
    id: "DUPLICATE_PROVIDER_ORDER_ID",
    severity: "HIGH",
    description: "Provider order ids must not collide inside the same provider/domain.",
    sql: `
      SELECT MIN(id::text)::uuid AS id, MIN(owner_id::text)::uuid AS owner_id, MIN(hostel_id::text)::uuid AS hostel_id,
             'unique provider_order_id per provider/domain' AS expected,
             COUNT(*)::text AS actual,
             jsonb_build_object('provider', provider, 'payment_domain', payment_domain, 'provider_order_id', provider_order_id) AS metadata
      FROM payment_attempts
      WHERE provider_order_id IS NOT NULL
      GROUP BY provider, payment_domain, provider_order_id
      HAVING COUNT(*) > 1
      LIMIT 1000
    `,
  },
  {
    id: "SIGNATURE_FAILURE_HAS_ANOMALY",
    severity: "HIGH",
    description: "Failed webhook signature verification must create a durable anomaly.",
    sql: `
      SELECT e.id, e.operational_owner_id AS owner_id, e.hostel_id,
             'WEBHOOK_SIGNATURE_FAILED anomaly' AS expected,
             'none' AS actual,
             jsonb_build_object('provider', e.provider, 'signature_failure_reason', e.signature_failure_reason) AS metadata
      FROM payment_webhook_events e
      WHERE e.signature_verified = false
        AND NOT EXISTS (
          SELECT 1 FROM payment_operational_anomalies a
          WHERE a.webhook_event_id = e.id
            AND a.anomaly_type = 'WEBHOOK_SIGNATURE_FAILED'
        )
      LIMIT 1000
    `,
  },
  {
    id: "TERMINAL_PROVIDER_STATUS_HAS_SNAPSHOT",
    severity: "HIGH",
    description: "Provider-verified terminal attempt transitions should have a durable source-of-truth snapshot.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'provider verification snapshot' AS expected,
             'none' AS actual,
             jsonb_build_object('status', pa.status, 'merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id)) AS metadata
      FROM payment_attempts pa
      WHERE pa.status IN ('SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED')
        AND pa.provider IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM payment_attempt_status_events e
          WHERE e.payment_attempt_id = pa.id
            AND e.source IN ('WEBHOOK', 'VERIFY', 'RECONCILE')
        )
        AND pa.created_at > TIMESTAMPTZ '2026-05-12 00:00:00+00'
        AND NOT EXISTS (
          SELECT 1 FROM payment_provider_verification_snapshots s
          WHERE s.payment_attempt_id = pa.id
        )
      LIMIT 1000
    `,
  },
  {
    id: "STALE_SETTLEMENT_LOCK",
    severity: "HIGH",
    description: "PROCESSING or PENDING_VERIFICATION attempts older than 5 minutes require reconciliation attention.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'not stale settlement lock' AS expected,
             pa.status AS actual,
             jsonb_build_object('updated_at', pa.updated_at, 'merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id)) AS metadata
      FROM payment_attempts pa
      WHERE pa.status IN ('PROCESSING', 'PENDING_VERIFICATION')
        AND pa.updated_at < NOW() - INTERVAL '5 minutes'
      LIMIT 1000
    `,
  },
  {
    id: "OPEN_CRITICAL_OPERATIONAL_ANOMALY",
    severity: "HIGH",
    description: "Open critical payment anomalies must be visible and resolved before rollout.",
    sql: `
      SELECT a.id, a.operational_owner_id AS owner_id, a.hostel_id,
             'no open critical anomalies' AS expected,
             a.anomaly_type AS actual,
             jsonb_build_object('payment_attempt_id', a.payment_attempt_id, 'status', a.status, 'detected_at', a.detected_at) AS metadata
      FROM payment_operational_anomalies a
      WHERE a.status = 'OPEN'
        AND a.severity IN ('CRITICAL', 'HIGH')
      LIMIT 1000
    `,
  },
  {
    id: "EXPIRED_PENDING_ATTEMPT",
    severity: "MEDIUM",
    description: "Expired pending attempts should be swept by reconciliation.",
    sql: `
      SELECT pa.id, pa.owner_id, pa.hostel_id,
             'terminal EXPIRED or reconciled state' AS expected,
             pa.status AS actual,
             jsonb_build_object('expires_at', pa.expires_at, 'merchant_transaction_id', COALESCE(pa.merchant_transaction_id, pa.merchant_txn_id)) AS metadata
      FROM payment_attempts pa
      WHERE pa.status = 'PENDING'
        AND pa.expires_at < NOW()
      LIMIT 1000
    `,
  },
];

async function query(sql: string) {
  return prisma.$queryRawUnsafe<any[]>(sql);
}

async function missingSchemaObjects() {
  const requiredTables = [
    "payment_webhook_events",
    "payment_provider_verification_snapshots",
    "payment_attempt_status_events",
    "payment_operational_anomalies",
    "payment_reconciliation_runs",
    "payment_reconciliation_items",
  ];
  const requiredAttemptColumns = [
    "payment_domain",
    "scope_type",
    "flow_type",
    "merchant_context_type",
    "merchant_context_id",
    "settlement_status",
    "settled_at",
    "merchant_transaction_id",
    "provider_transaction_id",
    "provider_order_id",
    "provider_reference_id",
  ];
  const requiredTriggers = [
    "trg_prevent_payment_ledger_update",
    "trg_prevent_payment_ledger_delete",
  ];

  const tableRows = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${requiredTables.map((t) => `'${t}'`).join(",")})
  `);
  const columnRows = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_attempts'
      AND column_name IN (${requiredAttemptColumns.map((c) => `'${c}'`).join(",")})
  `);
  const triggerRows = await query(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'payments'
      AND trigger_name IN (${requiredTriggers.map((t) => `'${t}'`).join(",")})
  `);

  const presentTables = new Set(tableRows.map((r) => String(r.table_name)));
  const presentColumns = new Set(columnRows.map((r) => String(r.column_name)));
  const presentTriggers = new Set(triggerRows.map((r) => String(r.trigger_name)));

  return {
    tables: requiredTables.filter((t) => !presentTables.has(t)),
    payment_attempt_columns: requiredAttemptColumns.filter((c) => !presentColumns.has(c)),
    payment_ledger_triggers: requiredTriggers.filter((t) => !presentTriggers.has(t)),
  };
}

async function main() {
  const warnOnly = process.argv.includes("--warn-only");
  const started = Date.now();
  const findings: Finding[] = [];

  const missing = await missingSchemaObjects();
  if (missing.tables.length > 0 || missing.payment_attempt_columns.length > 0 || missing.payment_ledger_triggers.length > 0) {
    console.log(JSON.stringify({
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      schema_ready: false,
      message: "Financial safety migration has not been applied to this database.",
      missing,
      next_step: "Apply backend-next/prisma/migrations/20260512120000_financial_safety_release_foundation before running data invariants.",
      exit_policy: warnOnly ? "warn-only" : "fail on schema not ready",
    }, null, 2));
    if (!warnOnly) process.exitCode = 1;
    return;
  }

  for (const check of checks) {
    const rows = await query(check.sql);
    for (const row of rows) {
      findings.push({
        check_id: check.id,
        severity: check.severity,
        description: check.description,
        entity_id: row.id ? String(row.id) : null,
        owner_id: row.owner_id ? String(row.owner_id) : null,
        hostel_id: row.hostel_id ? String(row.hostel_id) : null,
        expected: row.expected == null ? null : String(row.expected),
        actual: row.actual == null ? null : String(row.actual),
        metadata: row.metadata || {},
      });
    }
  }

  const bySeverity: Record<Severity, number> = {
    CRITICAL: findings.filter((f) => f.severity === "CRITICAL").length,
    HIGH: findings.filter((f) => f.severity === "HIGH").length,
    MEDIUM: findings.filter((f) => f.severity === "MEDIUM").length,
    LOW: findings.filter((f) => f.severity === "LOW").length,
  };

  const report = {
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    checks: checks.length,
    total_findings: findings.length,
    findings_by_severity: bySeverity,
    exit_policy: warnOnly ? "warn-only" : "fail on CRITICAL or HIGH",
    findings: findings.slice(0, 200),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!warnOnly && (bySeverity.CRITICAL > 0 || bySeverity.HIGH > 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("payment-financial-safety-check failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
