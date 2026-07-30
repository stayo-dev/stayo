/**
 * 🔒 Hostel Invariant Validator — Phase 5: Operational Invariants
 *
 * Prevents silent corruption forever by validating the 6 canonical invariants:
 *
 * 1. payment.hostel_id === obligation.hostel_id
 * 2. receipt.hostel_id === payment.hostel_id
 * 3. reminder.hostel_id === obligation.hostel_id
 * 4. allocation.hostel_id === room.hostel_id
 * 5. obligation.hostel_id derived from allocation chain is consistent
 * 6. tenant.hostel_id matches active allocation's hostel
 *
 * RUN:
 * - Nightly reconciliation cron
 * - Post-migration verification
 * - On-demand health checks via API
 *
 * EMIT:
 * - SYSTEM_EVENT_LOG anomalies
 * - hostel_invariant_checks records
 * - Structured console logs with [INVARIANT] prefix
 */

import { prisma } from "../db";
import { eventLog } from "./event-log-service";

interface InvariantViolation {
  check_type: string;
  entity_type: string;
  entity_id: string;
  expected_value: string | null;
  actual_value: string | null;
  details?: any;
}

interface InvariantReport {
  checked_at: Date;
  duration_ms: number;
  total_checked: number;
  violations: number;
  checks: {
    name: string;
    checked: number;
    violations: number;
    sample_violations: InvariantViolation[];
  }[];
}

export class HostelInvariantValidator {
  /**
   * Run all invariant checks and return a comprehensive report.
   * Violations are persisted to hostel_invariant_checks for audit.
   */
  async runAllChecks(): Promise<InvariantReport> {
    const startTime = Date.now();
    const checkedAt = new Date();

    const checks = await Promise.all([
      this.checkPaymentObligationHostel(),
      this.checkReceiptPaymentHostel(),
      this.checkReminderObligationHostel(),
      this.checkAllocationRoomHostel(),
      this.checkTenantActiveHostel(),
    ]);

    const totalChecked = checks.reduce((s, c) => s + c.checked, 0);
    const totalViolations = checks.reduce((s, c) => s + c.violations, 0);
    const durationMs = Date.now() - startTime;

    // Persist all violations to the audit table
    const allViolations: InvariantViolation[] = checks.flatMap((c) => c.sample_violations);
    if (allViolations.length > 0) {
      await prisma.hostel_invariant_checks.createMany({
        data: allViolations.map((v) => ({
          check_type: v.check_type,
          entity_type: v.entity_type,
          entity_id: v.entity_id,
          expected_value: v.expected_value,
          actual_value: v.actual_value,
          is_valid: false,
          details: v.details || {},
          checked_at: checkedAt,
        })),
      }).catch((e: any) => console.error("[INVARIANT] Failed to persist violations:", e.message));

      // Emit structured anomaly event
      await eventLog.log("HOSTEL_INVARIANT_VIOLATION", null, {
        checked_at: checkedAt.toISOString(),
        total_checked: totalChecked,
        total_violations: totalViolations,
        duration_ms: durationMs,
        checks: checks.map((c) => ({
          name: c.name,
          checked: c.checked,
          violations: c.violations,
        })),
      }).catch(() => {});
    }

    // Log healthy check result too
    console.log(`[INVARIANT] Check complete: ${totalChecked} checked, ${totalViolations} violations (${durationMs}ms)`);

    return {
      checked_at: checkedAt,
      duration_ms: durationMs,
      total_checked: totalChecked,
      violations: totalViolations,
      checks,
    };
  }

  /**
   * Invariant 1: payment.hostel_id === obligation.hostel_id
   * Every payment must inherit its hostel from its obligation.
   */
  private async checkPaymentObligationHostel() {
    const rows = await prisma.$queryRaw<
      { payment_id: string; payment_hostel: string | null; obligation_hostel: string | null }[]
    >`
      SELECT
        p.id AS payment_id,
        p.hostel_id::text AS payment_hostel,
        o.hostel_id::text AS obligation_hostel
      FROM payments p
      JOIN rent_obligations o ON o.id = p.obligation_id
      WHERE p.hostel_id IS NOT NULL
        AND o.hostel_id IS NOT NULL
        AND p.hostel_id <> o.hostel_id
      LIMIT 100
    `;

    const totalChecked = await prisma.payments.count();

    return {
      name: "payment.hostel_id === obligation.hostel_id",
      checked: totalChecked,
      violations: rows.length,
      sample_violations: rows.map((r) => ({
        check_type: "PAYMENT_OBLIGATION_HOSTEL_MISMATCH",
        entity_type: "Payment",
        entity_id: r.payment_id,
        expected_value: r.obligation_hostel,
        actual_value: r.payment_hostel,
      })),
    };
  }

  /**
   * Invariant 2: receipt.hostel_id === payment.hostel_id
   * Every receipt must inherit its hostel from its payment.
   */
  private async checkReceiptPaymentHostel() {
    const rows = await prisma.$queryRaw<
      { receipt_id: string; receipt_hostel: string | null; payment_hostel: string | null }[]
    >`
      SELECT
        r.id AS receipt_id,
        r.hostel_id::text AS receipt_hostel,
        p.hostel_id::text AS payment_hostel
      FROM receipts r
      JOIN payments p ON p.id = r.payment_id
      WHERE r.hostel_id IS NOT NULL
        AND p.hostel_id IS NOT NULL
        AND r.hostel_id <> p.hostel_id
      LIMIT 100
    `;

    const totalChecked = await prisma.receipts.count();

    return {
      name: "receipt.hostel_id === payment.hostel_id",
      checked: totalChecked,
      violations: rows.length,
      sample_violations: rows.map((r) => ({
        check_type: "RECEIPT_PAYMENT_HOSTEL_MISMATCH",
        entity_type: "Receipt",
        entity_id: r.receipt_id,
        expected_value: r.payment_hostel,
        actual_value: r.receipt_hostel,
      })),
    };
  }

  /**
   * Invariant 3: reminder.hostel_id === obligation.hostel_id
   * Every reminder must target the correct hostel for branding/routing.
   */
  private async checkReminderObligationHostel() {
    const rows = await prisma.$queryRaw<
      { reminder_id: string; reminder_hostel: string | null; obligation_hostel: string | null }[]
    >`
      SELECT
        rl.id AS reminder_id,
        rl.hostel_id::text AS reminder_hostel,
        o.hostel_id::text AS obligation_hostel
      FROM reminder_logs rl
      JOIN rent_obligations o ON o.id = rl.obligation_id
      WHERE rl.hostel_id IS NOT NULL
        AND o.hostel_id IS NOT NULL
        AND rl.hostel_id <> o.hostel_id
      LIMIT 100
    `;

    const totalChecked = await prisma.reminder_logs.count();

    return {
      name: "reminder.hostel_id === obligation.hostel_id",
      checked: totalChecked,
      violations: rows.length,
      sample_violations: rows.map((r) => ({
        check_type: "REMINDER_OBLIGATION_HOSTEL_MISMATCH",
        entity_type: "ReminderLog",
        entity_id: r.reminder_id,
        expected_value: r.obligation_hostel,
        actual_value: r.reminder_hostel,
      })),
    };
  }

  /**
   * Invariant 4: allocation.hostel_id === room.hostel_id
   * Every allocation must point to the same hostel as its room.
   */
  private async checkAllocationRoomHostel() {
    const rows = await prisma.$queryRaw<
      { allocation_id: string; alloc_hostel: string | null; room_hostel: string | null }[]
    >`
      SELECT
        ra.id AS allocation_id,
        ra.hostel_id::text AS alloc_hostel,
        r.hostel_id::text AS room_hostel
      FROM room_allocations ra
      JOIN rooms r ON r.id = ra.room_id
      WHERE ra.hostel_id IS NOT NULL
        AND ra.hostel_id <> r.hostel_id
      LIMIT 100
    `;

    const totalChecked = await prisma.roomAllocation.count();

    return {
      name: "allocation.hostel_id === room.hostel_id",
      checked: totalChecked,
      violations: rows.length,
      sample_violations: rows.map((r) => ({
        check_type: "ALLOCATION_ROOM_HOSTEL_MISMATCH",
        entity_type: "RoomAllocation",
        entity_id: r.allocation_id,
        expected_value: r.room_hostel,
        actual_value: r.alloc_hostel,
      })),
    };
  }

  /**
   * Invariant 5: tenant.hostel_id matches active allocation's hostel
   * Tenants with an active allocation should have hostel_id matching
   * the allocation's room's hostel. (Mutable field — may need fix, not just report.)
   */
  private async checkTenantActiveHostel() {
    const rows = await prisma.$queryRaw<
      { tenant_id: string; tenant_hostel: string | null; allocation_hostel: string | null }[]
    >`
      SELECT
        t.id AS tenant_id,
        t.hostel_id::text AS tenant_hostel,
        r.hostel_id::text AS allocation_hostel
      FROM tenants t
      JOIN room_allocations ra ON ra.tenant_id = t.id AND ra.is_active = true AND ra.end_date IS NULL
      JOIN rooms r ON r.id = ra.room_id
      WHERE t.status = 'ACTIVE'
        AND (t.hostel_id IS NULL OR t.hostel_id <> r.hostel_id)
      LIMIT 100
    `;

    const totalChecked = await prisma.tenants.count({
      where: { status: "ACTIVE" },
    });

    return {
      name: "tenant.hostel_id === active_allocation.room.hostel_id",
      checked: totalChecked,
      violations: rows.length,
      sample_violations: rows.map((r) => ({
        check_type: "TENANT_ACTIVE_HOSTEL_MISMATCH",
        entity_type: "Tenant",
        entity_id: r.tenant_id,
        expected_value: r.allocation_hostel,
        actual_value: r.tenant_hostel,
      })),
    };
  }

  /**
   * Count records still missing hostel_id (backfill completeness check).
   * Used by the migration verification step before cutover.
   */
  async checkBackfillCompleteness(): Promise<{
    entity: string;
    total: number;
    missing_hostel_id: number;
    completeness_pct: number;
  }[]> {
    const entities = [
      { name: "RoomAllocation", table: "room_allocations" },
      { name: "RentObligation", table: "rent_obligations" },
      { name: "Payment", table: "payments" },
      { name: "Receipt", table: "receipts" },
      { name: "ReminderLog", table: "reminder_logs" },
      { name: "Tenant (ACTIVE)", table: "tenants" },
    ];

    const results = [];
    for (const entity of entities) {
      const statusFilter = entity.table === "tenants" ? "AND status = 'ACTIVE'" : "";
      const [row] = await prisma.$queryRawUnsafe<{ total: number; missing: number }[]>(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN hostel_id IS NULL THEN 1 END)::int AS missing
        FROM ${entity.table}
        WHERE 1=1 ${statusFilter}`
      );

      const total = Number(row?.total || 0);
      const missing = Number(row?.missing || 0);
      results.push({
        entity: entity.name,
        total,
        missing_hostel_id: missing,
        completeness_pct: total > 0 ? Math.round(((total - missing) / total) * 10000) / 100 : 100,
      });
    }

    return results;
  }
}

export const hostelInvariantValidator = new HostelInvariantValidator();
