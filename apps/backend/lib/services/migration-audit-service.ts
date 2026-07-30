import { randomUUID } from "crypto";
import { prisma } from "../db";
import { eventLog } from "./event-log-service";

type AuditSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type AuditRecord = {
  type: string;
  entity_type: string;
  entity_id: string | null;
  owner_id?: string | null;
  hostel_id?: string | null;
  expected_hostel_id?: string | null;
  actual_hostel_id?: string | null;
  severity: AuditSeverity;
  details?: Record<string, any>;
};

type RollupValidation = {
  owner_id: string;
  metric: string;
  owner_total: number;
  hostel_sum: number;
  difference: number;
  is_valid: boolean;
};

type MigrationAuditArtifact = {
  generated_at: string;
  orphan_count: number;
  mismatch_count: number;
  unresolved_records: AuditRecord[];
  corrected_records: AuditRecord[];
  corruption_candidates: AuditRecord[];
  hostel_rollup_validation: RollupValidation[];
  dual_read_validation: DualReadValidationResult[];
  summary: {
    unresolved_records_count: number;
    corrected_records_count: number;
    corruption_candidates_count: number;
    rollup_mismatch_count: number;
    dual_read_mismatch_count: number;
  };
};

type DualReadValidationResult = {
  entity_type: "Payment" | "Receipt" | "ReminderLog" | "RentObligation" | "RoomAllocation";
  checked: number;
  mismatch_count: number;
  sample_mismatches: AuditRecord[];
};

function toNumber(value: any) {
  return Number(value || 0);
}

async function rows<T = any>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

export class MigrationAuditService {
  async runFullAudit(): Promise<MigrationAuditArtifact & { artifact_path: string }> {
    const generatedAt = new Date();
    const [orphans, drifts, historical, rollups, dualRead] = await Promise.all([
      this.detectOrphans(),
      this.detectHostelDrift(),
      this.verifyHistoricalAttribution(),
      this.verifyHostelRollups(),
      this.runDualReadValidation(),
    ]);

    const unresolved = [...orphans, ...drifts, ...historical];
    const corruptionCandidates = unresolved.filter((r) => r.severity === "CRITICAL" || r.severity === "HIGH");
    const artifact: MigrationAuditArtifact = {
      generated_at: generatedAt.toISOString(),
      orphan_count: orphans.length,
      mismatch_count: drifts.length + dualRead.reduce((sum, r) => sum + r.mismatch_count, 0),
      unresolved_records: unresolved,
      corrected_records: [],
      corruption_candidates: corruptionCandidates,
      hostel_rollup_validation: rollups,
      dual_read_validation: dualRead,
      summary: {
        unresolved_records_count: unresolved.length,
        corrected_records_count: 0,
        corruption_candidates_count: corruptionCandidates.length,
        rollup_mismatch_count: rollups.filter((r) => !r.is_valid).length,
        dual_read_mismatch_count: dualRead.reduce((sum, r) => sum + r.mismatch_count, 0),
      },
    };

    const auditRunId = randomUUID();
    const artifactPath = `database://migration_audit_runs/${auditRunId}`;

    await (prisma as any).migrationAuditRun.create({
      data: {
        id: auditRunId,
        artifact_path: artifactPath,
        orphan_count: artifact.orphan_count,
        mismatch_count: artifact.mismatch_count,
        unresolved_records_count: artifact.summary.unresolved_records_count,
        corrected_records_count: artifact.summary.corrected_records_count,
        corruption_candidates_count: artifact.summary.corruption_candidates_count,
        hostel_rollup_validation: artifact.hostel_rollup_validation,
        summary: artifact.summary,
        artifact,
      },
    });

    await this.emitAuditEvents(artifact);
    return { ...artifact, artifact_path: artifactPath };
  }

  async detectOrphans(): Promise<AuditRecord[]> {
    const result: AuditRecord[] = [];
    const queries: Array<{ type: string; severity: AuditSeverity; sql: string; entity: string }> = [
      {
        type: "PAYMENT_WITHOUT_OBLIGATION",
        entity: "Payment",
        severity: "CRITICAL",
        sql: `SELECT p.id, p.owner_id, p.hostel_id FROM payments p LEFT JOIN rent_obligations o ON o.id = p.obligation_id WHERE o.id IS NULL LIMIT 500`,
      },
      {
        type: "RECEIPT_WITHOUT_PAYMENT",
        entity: "Receipt",
        severity: "CRITICAL",
        sql: `SELECT r.id, r.owner_id, r.hostel_id FROM receipts r LEFT JOIN payments p ON p.id = r.payment_id WHERE p.id IS NULL LIMIT 500`,
      },
      {
        type: "REMINDER_WITHOUT_OBLIGATION",
        entity: "ReminderLog",
        severity: "HIGH",
        sql: `SELECT rl.id, NULL::uuid AS owner_id, rl.hostel_id FROM reminder_logs rl LEFT JOIN rent_obligations o ON o.id = rl.obligation_id WHERE o.id IS NULL LIMIT 500`,
      },
      {
        type: "ALLOCATION_WITHOUT_ROOM",
        entity: "RoomAllocation",
        severity: "HIGH",
        sql: `SELECT ra.id, NULL::uuid AS owner_id, ra.hostel_id FROM room_allocations ra LEFT JOIN rooms r ON r.id = ra.room_id WHERE r.id IS NULL LIMIT 500`,
      },
      {
        type: "ACTIVE_TENANT_WITHOUT_HOSTEL",
        entity: "Tenant",
        severity: "MEDIUM",
        sql: `SELECT t.id, t.owner_id, t.hostel_id FROM tenants t WHERE t.status = 'ACTIVE' AND t.hostel_id IS NULL LIMIT 500`,
      },
      {
        type: "OBLIGATION_WITHOUT_HOSTEL_ID",
        entity: "RentObligation",
        severity: "CRITICAL",
        sql: `SELECT o.id, o.owner_id, o.hostel_id FROM rent_obligations o WHERE o.hostel_id IS NULL LIMIT 500`,
      },
    ];

    for (const q of queries) {
      const found = await rows<{ id: string; owner_id: string | null; hostel_id: string | null }>(q.sql);
      result.push(...found.map((r) => ({
        type: q.type,
        entity_type: q.entity,
        entity_id: r.id,
        owner_id: r.owner_id,
        hostel_id: r.hostel_id,
        severity: q.severity,
      })));
    }
    return result;
  }

  async detectHostelDrift(): Promise<AuditRecord[]> {
    const driftQueries: Array<{ type: string; entity: string; severity: AuditSeverity; sql: string }> = [
      {
        type: "PAYMENT_OBLIGATION_HOSTEL_DRIFT",
        entity: "Payment",
        severity: "CRITICAL",
        sql: `SELECT p.id, p.owner_id, p.hostel_id::text AS actual_hostel_id, o.hostel_id::text AS expected_hostel_id FROM payments p JOIN rent_obligations o ON o.id = p.obligation_id WHERE p.hostel_id IS DISTINCT FROM o.hostel_id LIMIT 500`,
      },
      {
        type: "RECEIPT_PAYMENT_HOSTEL_DRIFT",
        entity: "Receipt",
        severity: "CRITICAL",
        sql: `SELECT r.id, r.owner_id, r.hostel_id::text AS actual_hostel_id, p.hostel_id::text AS expected_hostel_id FROM receipts r JOIN payments p ON p.id = r.payment_id WHERE r.hostel_id IS DISTINCT FROM p.hostel_id LIMIT 500`,
      },
      {
        type: "REMINDER_OBLIGATION_HOSTEL_DRIFT",
        entity: "ReminderLog",
        severity: "HIGH",
        sql: `SELECT rl.id, o.owner_id, rl.hostel_id::text AS actual_hostel_id, o.hostel_id::text AS expected_hostel_id FROM reminder_logs rl JOIN rent_obligations o ON o.id = rl.obligation_id WHERE rl.hostel_id IS DISTINCT FROM o.hostel_id LIMIT 500`,
      },
      {
        type: "ALLOCATION_ROOM_HOSTEL_DRIFT",
        entity: "RoomAllocation",
        severity: "MEDIUM",
        sql: `SELECT ra.id, h.owner_id, ra.hostel_id::text AS actual_hostel_id, r.hostel_id::text AS expected_hostel_id FROM room_allocations ra JOIN rooms r ON r.id = ra.room_id JOIN hostels h ON h.id = r.hostel_id WHERE ra.hostel_id IS DISTINCT FROM r.hostel_id LIMIT 500`,
      },
      {
        type: "TENANT_ACTIVE_ALLOCATION_HOSTEL_DRIFT",
        entity: "Tenant",
        severity: "MEDIUM",
        sql: `SELECT t.id, t.owner_id, t.hostel_id::text AS actual_hostel_id, ra.hostel_id::text AS expected_hostel_id FROM tenants t JOIN room_allocations ra ON ra.tenant_id = t.id AND ra.is_active = true AND ra.end_date IS NULL WHERE t.hostel_id IS DISTINCT FROM ra.hostel_id LIMIT 500`,
      },
    ];

    const result: AuditRecord[] = [];
    for (const q of driftQueries) {
      const found = await rows<any>(q.sql);
      result.push(...found.map((r) => ({
        type: q.type,
        entity_type: q.entity,
        entity_id: r.id,
        owner_id: r.owner_id,
        hostel_id: r.actual_hostel_id,
        expected_hostel_id: r.expected_hostel_id,
        actual_hostel_id: r.actual_hostel_id,
        severity: q.severity,
      })));
    }
    return result;
  }

  async verifyHistoricalAttribution(): Promise<AuditRecord[]> {
    const transferRows = await rows<any>(`
      SELECT 'OBLIGATION_TRANSFER_REWRITE_CANDIDATE' AS type, 'RentObligation' AS entity_type,
             o.id, o.owner_id, o.hostel_id::text AS actual_hostel_id, ttl.from_hostel_id::text AS expected_hostel_id,
             ttl.id::text AS transfer_log_id, ttl.transferred_at
      FROM tenant_transfer_logs ttl
      JOIN rent_obligations o ON o.tenant_id = ttl.tenant_id AND o.created_at < ttl.transferred_at
      WHERE o.hostel_id IS DISTINCT FROM ttl.from_hostel_id
      UNION ALL
      SELECT 'PAYMENT_TRANSFER_REWRITE_CANDIDATE' AS type, 'Payment' AS entity_type,
             p.id, p.owner_id, p.hostel_id::text AS actual_hostel_id, ttl.from_hostel_id::text AS expected_hostel_id,
             ttl.id::text AS transfer_log_id, ttl.transferred_at
      FROM tenant_transfer_logs ttl
      JOIN payments p ON p.tenant_id = ttl.tenant_id AND p.created_at < ttl.transferred_at
      WHERE p.hostel_id IS DISTINCT FROM ttl.from_hostel_id
      UNION ALL
      SELECT 'RECEIPT_TRANSFER_REWRITE_CANDIDATE' AS type, 'Receipt' AS entity_type,
             r.id, r.owner_id, r.hostel_id::text AS actual_hostel_id, ttl.from_hostel_id::text AS expected_hostel_id,
             ttl.id::text AS transfer_log_id, ttl.transferred_at
      FROM tenant_transfer_logs ttl
      JOIN receipts r ON r.tenant_id = ttl.tenant_id AND r.issued_at < ttl.transferred_at
      WHERE r.hostel_id IS DISTINCT FROM ttl.from_hostel_id
      LIMIT 500
    `);

    return transferRows.map((r) => ({
      type: r.type,
      entity_type: r.entity_type,
      entity_id: r.id,
      owner_id: r.owner_id,
      hostel_id: r.actual_hostel_id,
      expected_hostel_id: r.expected_hostel_id,
      actual_hostel_id: r.actual_hostel_id,
      severity: "CRITICAL" as AuditSeverity,
      details: { transfer_log_id: r.transfer_log_id, transferred_at: r.transferred_at },
    }));
  }

  async verifyHostelRollups(): Promise<RollupValidation[]> {
    const sql = `
      WITH owners AS (SELECT DISTINCT owner_id FROM hostels),
      owner_metrics AS (
        SELECT o.owner_id,
          COALESCE((SELECT SUM(amount_paid)::float FROM payments p WHERE p.owner_id = o.owner_id), 0) AS collections,
          COALESCE((SELECT SUM(amount)::float FROM rent_obligations ro WHERE ro.owner_id = o.owner_id AND ro.status IN ('PENDING','PARTIAL') AND ro.due_date < CURRENT_DATE), 0) AS overdue,
          COALESCE((SELECT COUNT(*)::float FROM room_allocations ra JOIN tenants t ON t.id = ra.tenant_id WHERE t.owner_id = o.owner_id AND ra.is_active = true AND ra.end_date IS NULL), 0) AS occupancy,
          COALESCE((SELECT SUM(amount)::float FROM rent_obligations ro WHERE ro.owner_id = o.owner_id), 0) AS revenue,
          COALESCE((SELECT SUM(amount)::float FROM expenses e WHERE e.owner_id = o.owner_id AND e.expense_scope = 'HOSTEL'), 0) AS expenses,
          COALESCE((SELECT COUNT(*)::float FROM reminder_logs rl JOIN rent_obligations ro ON ro.id = rl.obligation_id WHERE ro.owner_id = o.owner_id), 0) AS reminders,
          COALESCE((SELECT COUNT(*)::float FROM payments p WHERE p.owner_id = o.owner_id), 0) AS payment_counts
        FROM owners o
      ), hostel_metrics AS (
        SELECT o.owner_id,
          COALESCE((SELECT SUM(amount_paid)::float FROM payments p JOIN hostels h ON h.id = p.hostel_id WHERE h.owner_id = o.owner_id), 0) AS collections,
          COALESCE((SELECT SUM(amount)::float FROM rent_obligations ro JOIN hostels h ON h.id = ro.hostel_id WHERE h.owner_id = o.owner_id AND ro.status IN ('PENDING','PARTIAL') AND ro.due_date < CURRENT_DATE), 0) AS overdue,
          COALESCE((SELECT COUNT(*)::float FROM room_allocations ra JOIN hostels h ON h.id = ra.hostel_id WHERE h.owner_id = o.owner_id AND ra.is_active = true AND ra.end_date IS NULL), 0) AS occupancy,
          COALESCE((SELECT SUM(amount)::float FROM rent_obligations ro JOIN hostels h ON h.id = ro.hostel_id WHERE h.owner_id = o.owner_id), 0) AS revenue,
          COALESCE((SELECT SUM(amount)::float FROM expenses e JOIN hostels h ON h.id = e.hostel_id WHERE h.owner_id = o.owner_id AND e.expense_scope = 'HOSTEL'), 0) AS expenses,
          COALESCE((SELECT COUNT(*)::float FROM reminder_logs rl JOIN hostels h ON h.id = rl.hostel_id WHERE h.owner_id = o.owner_id), 0) AS reminders,
          COALESCE((SELECT COUNT(*)::float FROM payments p JOIN hostels h ON h.id = p.hostel_id WHERE h.owner_id = o.owner_id), 0) AS payment_counts
        FROM owners o
      )
      SELECT om.owner_id::text, metric, owner_total, hostel_sum, (owner_total - hostel_sum) AS difference
      FROM owner_metrics om
      JOIN hostel_metrics hm ON hm.owner_id = om.owner_id
      CROSS JOIN LATERAL (VALUES
        ('collections', om.collections, hm.collections),
        ('overdue', om.overdue, hm.overdue),
        ('occupancy', om.occupancy, hm.occupancy),
        ('revenue', om.revenue, hm.revenue),
        ('expenses', om.expenses, hm.expenses),
        ('reminders', om.reminders, hm.reminders),
        ('payment_counts', om.payment_counts, hm.payment_counts)
      ) AS v(metric, owner_total, hostel_sum)
    `;

    const found = await rows<any>(sql);
    return found.map((r) => {
      const difference = Math.round(toNumber(r.difference) * 100) / 100;
      return {
        owner_id: r.owner_id,
        metric: r.metric,
        owner_total: toNumber(r.owner_total),
        hostel_sum: toNumber(r.hostel_sum),
        difference,
        is_valid: Math.abs(difference) < 0.01,
      };
    });
  }

  async runDualReadValidation(): Promise<DualReadValidationResult[]> {
    const checks: Array<{ entity: DualReadValidationResult["entity_type"]; sql: string; countSql: string; severity: AuditSeverity }> = [
      {
        entity: "Payment",
        severity: "CRITICAL",
        countSql: `SELECT COUNT(*)::int AS count FROM payments`,
        sql: `SELECT p.id, p.owner_id, p.hostel_id::text AS actual_hostel_id, o.hostel_id::text AS expected_hostel_id FROM payments p JOIN rent_obligations o ON o.id = p.obligation_id WHERE p.hostel_id IS DISTINCT FROM o.hostel_id LIMIT 100`,
      },
      {
        entity: "Receipt",
        severity: "CRITICAL",
        countSql: `SELECT COUNT(*)::int AS count FROM receipts`,
        sql: `SELECT r.id, r.owner_id, r.hostel_id::text AS actual_hostel_id, p.hostel_id::text AS expected_hostel_id FROM receipts r JOIN payments p ON p.id = r.payment_id WHERE r.hostel_id IS DISTINCT FROM p.hostel_id LIMIT 100`,
      },
      {
        entity: "ReminderLog",
        severity: "HIGH",
        countSql: `SELECT COUNT(*)::int AS count FROM reminder_logs`,
        sql: `SELECT rl.id, o.owner_id, rl.hostel_id::text AS actual_hostel_id, o.hostel_id::text AS expected_hostel_id FROM reminder_logs rl JOIN rent_obligations o ON o.id = rl.obligation_id WHERE rl.hostel_id IS DISTINCT FROM o.hostel_id LIMIT 100`,
      },
      {
        entity: "RentObligation",
        severity: "CRITICAL",
        countSql: `SELECT COUNT(*)::int AS count FROM rent_obligations`,
        sql: `SELECT o.id, o.owner_id, o.hostel_id::text AS actual_hostel_id, ra.hostel_id::text AS expected_hostel_id FROM rent_obligations o JOIN room_allocations ra ON ra.id = o.allocation_id WHERE o.hostel_id IS DISTINCT FROM ra.hostel_id LIMIT 100`,
      },
      {
        entity: "RoomAllocation",
        severity: "MEDIUM",
        countSql: `SELECT COUNT(*)::int AS count FROM room_allocations`,
        sql: `SELECT ra.id, h.owner_id, ra.hostel_id::text AS actual_hostel_id, r.hostel_id::text AS expected_hostel_id FROM room_allocations ra JOIN rooms r ON r.id = ra.room_id JOIN hostels h ON h.id = r.hostel_id WHERE ra.hostel_id IS DISTINCT FROM r.hostel_id LIMIT 100`,
      },
    ];

    const results: DualReadValidationResult[] = [];
    for (const check of checks) {
      const [{ count = 0 } = { count: 0 }] = await rows<{ count: number }>(check.countSql);
      const mismatches = await rows<any>(check.sql);
      if (mismatches.length > 0) {
        await eventLog.log("HOSTEL_DRIFT_DETECTED", null, {
          entity_type: check.entity,
          mismatch_count: mismatches.length,
          mode: "dual_read_validation",
        });
      }
      results.push({
        entity_type: check.entity,
        checked: Number(count || 0),
        mismatch_count: mismatches.length,
        sample_mismatches: mismatches.map((r) => ({
          type: `${check.entity.toUpperCase()}_DUAL_READ_HOSTEL_MISMATCH`,
          entity_type: check.entity,
          entity_id: r.id,
          owner_id: r.owner_id,
          hostel_id: r.actual_hostel_id,
          expected_hostel_id: r.expected_hostel_id,
          actual_hostel_id: r.actual_hostel_id,
          severity: check.severity,
        })),
      });
    }
    return results;
  }

  private async emitAuditEvents(artifact: MigrationAuditArtifact) {
    if (artifact.orphan_count > 0) {
      await eventLog.log("ORPHAN_RECORD_DETECTED", null, { orphan_count: artifact.orphan_count });
    }
    if (artifact.mismatch_count > 0) {
      await eventLog.log("HOSTEL_DRIFT_DETECTED", null, { mismatch_count: artifact.mismatch_count });
    }
    if (artifact.summary.rollup_mismatch_count > 0) {
      await eventLog.log("HOSTEL_ROLLUP_MISMATCH", null, {
        mismatch_count: artifact.summary.rollup_mismatch_count,
        invalid_rollups: artifact.hostel_rollup_validation.filter((r) => !r.is_valid),
      });
      await eventLog.log("ANALYTICS_CONTAMINATION", null, { source: "migration_audit_rollup_validation" });
    }
  }
}

export const migrationAuditService = new MigrationAuditService();
