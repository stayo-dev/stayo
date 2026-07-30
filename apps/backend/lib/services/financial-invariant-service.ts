import { prisma } from "../db";
import { randomUUID } from "crypto";
import { eventLog } from "./event-log-service";
import { migrationAuditService } from "./migration-audit-service";
import { incrementIntegrityMetric } from "../metrics";

type InvariantSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type InvariantFailure = {
  invariant_type: string;
  severity: InvariantSeverity;
  entity_type: string;
  entity_id: string | null;
  expected_value: string | null;
  actual_value: string | null;
  owner_id?: string | null;
  hostel_id?: string | null;
  details?: Record<string, any>;
};

type InvariantRunReport = {
  checked_at: string;
  duration_ms: number;
  total_failures: number;
  failures_by_severity: Record<InvariantSeverity, number>;
  persisted_failures: number;
  rollup_mismatches: number;
};

async function query<T = any>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

export class FinancialInvariantService {
  async runAll(options: { persist?: boolean } = {}): Promise<InvariantRunReport> {
    const persist = options.persist !== false;
    const started = Date.now();
    const checkedAt = new Date().toISOString();

    const [relationalFailures, rollups] = await Promise.all([
      this.checkRelationalInvariants(),
      migrationAuditService.verifyHostelRollups(),
    ]);

    const rollupFailures: InvariantFailure[] = rollups
      .filter((r) => !r.is_valid)
      .map((r) => ({
        invariant_type: "HOSTEL_ROLLUP_MATCHES_OWNER_PORTFOLIO",
        severity: "HIGH",
        entity_type: "OwnerPortfolio",
        entity_id: r.owner_id,
        owner_id: r.owner_id,
        hostel_id: null,
        expected_value: String(r.owner_total),
        actual_value: String(r.hostel_sum),
        details: { metric: r.metric, difference: r.difference },
      }));

    const failures = [...relationalFailures, ...rollupFailures];
    let persisted = 0;
    if (persist && failures.length > 0) {
      await (prisma as any).financialInvariantFailure.createMany({
        data: failures.map((f) => ({
          id: randomUUID(),
          invariant_type: f.invariant_type,
          severity: f.severity,
          entity_type: f.entity_type,
          entity_id: f.entity_id,
          expected_value: f.expected_value,
          actual_value: f.actual_value,
          owner_id: f.owner_id || null,
          hostel_id: f.hostel_id || null,
          details: f.details || {},
        })),
      });
      persisted = failures.length;
    }

    await this.emitFailureEvents(failures);
    failures.forEach((f) => incrementIntegrityMetric("invariant_failure", f.severity));

    return {
      checked_at: checkedAt,
      duration_ms: Date.now() - started,
      total_failures: failures.length,
      failures_by_severity: {
        CRITICAL: failures.filter((f) => f.severity === "CRITICAL").length,
        HIGH: failures.filter((f) => f.severity === "HIGH").length,
        MEDIUM: failures.filter((f) => f.severity === "MEDIUM").length,
        LOW: failures.filter((f) => f.severity === "LOW").length,
      },
      persisted_failures: persisted,
      rollup_mismatches: rollupFailures.length,
    };
  }

  async checkRelationalInvariants(): Promise<InvariantFailure[]> {
    const checks: Array<{ invariant: string; severity: InvariantSeverity; event: string; sql: string }> = [
      {
        invariant: "payment.hostel_id === obligation.hostel_id",
        severity: "CRITICAL",
        event: "FINANCIAL_INVARIANT_FAILED",
        sql: `SELECT p.id, p.owner_id, p.hostel_id::text AS actual, o.hostel_id::text AS expected, p.hostel_id::text AS hostel_id FROM payments p JOIN rent_obligations o ON o.id = p.obligation_id WHERE p.hostel_id IS DISTINCT FROM o.hostel_id LIMIT 1000`,
      },
      {
        invariant: "receipt.hostel_id === payment.hostel_id",
        severity: "CRITICAL",
        event: "FINANCIAL_INVARIANT_FAILED",
        sql: `SELECT r.id, r.owner_id, r.hostel_id::text AS actual, p.hostel_id::text AS expected, r.hostel_id::text AS hostel_id FROM receipts r JOIN payments p ON p.id = r.payment_id WHERE r.hostel_id IS DISTINCT FROM p.hostel_id LIMIT 1000`,
      },
      {
        invariant: "reminder.hostel_id === obligation.hostel_id",
        severity: "HIGH",
        event: "HOSTEL_DRIFT_DETECTED",
        sql: `SELECT rl.id, o.owner_id, rl.hostel_id::text AS actual, o.hostel_id::text AS expected, rl.hostel_id::text AS hostel_id FROM reminder_logs rl JOIN rent_obligations o ON o.id = rl.obligation_id WHERE rl.hostel_id IS DISTINCT FROM o.hostel_id LIMIT 1000`,
      },
      {
        invariant: "allocation.hostel_id === room.hostel_id",
        severity: "MEDIUM",
        event: "HOSTEL_DRIFT_DETECTED",
        sql: `SELECT ra.id, h.owner_id, ra.hostel_id::text AS actual, r.hostel_id::text AS expected, ra.hostel_id::text AS hostel_id FROM room_allocations ra JOIN rooms r ON r.id = ra.room_id JOIN hostels h ON h.id = r.hostel_id WHERE ra.hostel_id IS DISTINCT FROM r.hostel_id LIMIT 1000`,
      },
      {
        invariant: "tenant.hostel_id === active_allocation.hostel_id",
        severity: "MEDIUM",
        event: "HOSTEL_DRIFT_DETECTED",
        sql: `SELECT t.id, t.owner_id, t.hostel_id::text AS actual, ra.hostel_id::text AS expected, t.hostel_id::text AS hostel_id FROM tenants t JOIN room_allocations ra ON ra.tenant_id = t.id AND ra.is_active = true AND ra.end_date IS NULL WHERE t.hostel_id IS DISTINCT FROM ra.hostel_id LIMIT 1000`,
      },
      {
        invariant: "historical hostel_id is populated on financial records",
        severity: "LOW",
        event: "ORPHAN_RECORD_DETECTED",
        sql: `SELECT o.id, o.owner_id, NULL::text AS actual, 'non-null hostel_id' AS expected, NULL::text AS hostel_id FROM rent_obligations o WHERE o.hostel_id IS NULL LIMIT 1000`,
      },
    ];

    const failures: InvariantFailure[] = [];
    for (const check of checks) {
      const found = await query<any>(check.sql);
      failures.push(...found.map((r) => ({
        invariant_type: check.invariant,
        severity: check.severity,
        entity_type: this.entityForInvariant(check.invariant),
        entity_id: r.id,
        owner_id: r.owner_id,
        hostel_id: r.hostel_id,
        expected_value: r.expected,
        actual_value: r.actual,
        details: { event_type: check.event },
      })));
    }
    return failures;
  }

  async getOperationalHealthMetrics() {
    const [openRows, latestAuditRows, snapshotRows] = await Promise.all([
      query<any>(`SELECT severity, COUNT(*)::int AS count FROM financial_invariant_failures WHERE status = 'OPEN' GROUP BY severity`),
      query<any>(`SELECT * FROM migration_audit_runs ORDER BY audit_date DESC LIMIT 1`),
      query<any>(`SELECT COUNT(*)::int AS count, MAX(created_at) AS latest_snapshot_at FROM hostel_daily_snapshots`),
    ]);

    const openBySeverity = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    } as Record<InvariantSeverity, number>;
    openRows.forEach((r) => { openBySeverity[r.severity as InvariantSeverity] = Number(r.count || 0); });

    const weightedPenalty = openBySeverity.CRITICAL * 35 + openBySeverity.HIGH * 15 + openBySeverity.MEDIUM * 7 + openBySeverity.LOW * 2;
    const hostelIntegrityScore = Math.max(0, 100 - weightedPenalty);
    const latestAudit = latestAuditRows[0] || null;

    return {
      mismatch_count: Number(latestAudit?.mismatch_count || 0),
      unresolved_records: Number(latestAudit?.unresolved_records_count || 0),
      orphan_count: Number(latestAudit?.orphan_count || 0),
      drift_percentage: latestAudit?.unresolved_records_count
        ? Math.round((Number(latestAudit.mismatch_count || 0) / Number(latestAudit.unresolved_records_count || 1)) * 10000) / 100
        : 0,
      hostel_integrity_score: hostelIntegrityScore,
      open_failures_by_severity: openBySeverity,
      reconciliation_health: openBySeverity.CRITICAL === 0 && openBySeverity.HIGH === 0 ? "HEALTHY" : "ACTION_REQUIRED",
      migration_cleanliness: Number(latestAudit?.corruption_candidates_count || 0) === 0 ? "CLEAN" : "CORRUPTION_CANDIDATES",
      hostel_isolation_health: Number(latestAudit?.mismatch_count || 0) === 0 ? "ISOLATED" : "DRIFT_DETECTED",
      snapshot_count: Number(snapshotRows[0]?.count || 0),
      latest_snapshot_at: snapshotRows[0]?.latest_snapshot_at || null,
    };
  }

  private entityForInvariant(invariant: string) {
    if (invariant.startsWith("payment.")) return "Payment";
    if (invariant.startsWith("receipt.")) return "Receipt";
    if (invariant.startsWith("reminder.")) return "ReminderLog";
    if (invariant.startsWith("allocation.")) return "RoomAllocation";
    if (invariant.startsWith("tenant.")) return "Tenant";
    return "RentObligation";
  }

  private async emitFailureEvents(failures: InvariantFailure[]) {
    if (failures.length === 0) return;

    const critical = failures.filter((f) => f.severity === "CRITICAL");
    const high = failures.filter((f) => f.severity === "HIGH");

    if (critical.length > 0) {
      await eventLog.log("FINANCIAL_INVARIANT_FAILED", null, {
        severity: "CRITICAL",
        count: critical.length,
        samples: critical.slice(0, 20),
      });
    }
    if (high.length > 0) {
      await eventLog.log("ANALYTICS_CONTAMINATION", null, {
        severity: "HIGH",
        count: high.length,
        samples: high.slice(0, 20),
      });
    }
  }
}

export const financialInvariantService = new FinancialInvariantService();
