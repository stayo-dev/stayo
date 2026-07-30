/**
 * 🔍 Rent Reconciliation Engine — Phase 6
 *
 * Verifies financial correctness instead of assuming success.
 *
 * PRINCIPLE: The generation pipeline says "obligations written".
 * This engine says "obligations verified".
 *
 * Rules:
 *  - Read-only: NEVER mutates financial records
 *  - Retry-safe: idempotent across multiple runs
 *  - Detection only: anomalies are flagged, not auto-corrected
 *
 * Anomalies detected:
 *  - MISSING:    Active allocation has no obligation for the month
 *  - DUPLICATE:  More than one RENT obligation per allocation per month
 *  - ORPHAN:     Obligation exists for an allocation that is no longer active
 *  - MISMATCH:   Actual count differs from expected count
 */

import { prisma } from "../db";
import { eventLog } from "./event-log-service";

export type ReconciliationStatus =
  | "OK"               // expected === actual, no anomalies
  | "MISSING"          // fewer obligations than expected
  | "DUPLICATE"        // duplicate obligations detected
  | "ORPHAN"          // obligations exist for inactive/ended allocations
  | "MISMATCH";        // catch-all for count discrepancies

export interface ReconciliationAnomaly {
  type: "MISSING" | "DUPLICATE" | "ORPHAN";
  allocation_id: string;
  tenant_id?: string;
  obligation_count?: number;
  message: string;
}

export interface ReconciliationResult {
  owner_id: string;
  hostel_id: string;
  rent_month: string;         // ISO string, always 1st of month
  obligation_type: string;
  expected_count: number;
  actual_count: number;
  missing_count: number;
  duplicate_count: number;
  orphan_count: number;
  status: ReconciliationStatus;
  anomalies: ReconciliationAnomaly[];
  reconciled_at: string;
  duration_ms: number;
}

export interface ReconciliationSummary {
  rent_month: string;
  owner_id?: string;
  hostel_id?: string;
  total_hostels: number;
  ok_count: number;
  failed_count: number;
  total_missing: number;
  total_duplicates: number;
  total_orphans: number;
  results: ReconciliationResult[];
  duration_ms: number;
}

export class RentReconciliationService {
  /**
   * Reconcile obligations for a specific hostel + month + obligation type.
   *
   * Compares the set of active allocations that SHOULD have obligations
   * against the set of obligations that actually exist.
   *
   * @param hostelId        - The hostel to reconcile
   * @param ownerId         - The owner of the hostel
   * @param rentMonthUTC    - First-of-month UTC date
   * @param obligationType  - "RENT" or "MAINTENANCE"
   */
  async reconcileHostelMonth(
    hostelId: string,
    ownerId: string,
    rentMonthUTC: Date,
    obligationType: "RENT" | "MAINTENANCE" = "RENT"
  ): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const anomalies: ReconciliationAnomaly[] = [];

    const lastDay = new Date(
      Date.UTC(
        rentMonthUTC.getUTCFullYear(),
        rentMonthUTC.getUTCMonth() + 1,
        0
      )
    ).getUTCDate();
    const monthEndDate = new Date(
      Date.UTC(
        rentMonthUTC.getUTCFullYear(),
        rentMonthUTC.getUTCMonth(),
        lastDay,
        23,
        59,
        59,
        999
      )
    );

    // 1. Fetch all active allocations for this hostel+owner that cover this month
    const activeAllocations = await prisma.roomAllocation.findMany({
      where: {
        is_active: true,
        start_date: { lte: monthEndDate },
        tenant: { status: "ACTIVE", owner_id: ownerId },
        room: { hostel_id: hostelId } as any,
        OR: [
          { end_date: null },
          { end_date: { gte: rentMonthUTC } },
        ],
      },
      select: {
        id: true,
        tenant: { select: { id: true, monthly_rent: true, maintenance_charge: true, maintenance_type: true } },
      },
    });

    // 2. For MAINTENANCE reconciliation, only count allocations that HAVE a maintenance charge
    const eligibleAllocations = activeAllocations.filter((alloc) => {
      if (obligationType === "RENT") {
        const rent = Number((alloc.tenant as any).monthly_rent) || 0;
        return rent > 0;
      }
      const maint = Number((alloc.tenant as any).maintenance_charge) || 0;
      const maintType = (alloc.tenant as any).maintenance_type || "MONTHLY";
      return maint > 0 && maintType === "MONTHLY";
    });

    const eligibleAllocationIds = new Set(eligibleAllocations.map((a) => a.id));
    const expectedCount = eligibleAllocations.length;

    // 3. Fetch ALL obligations for this hostel+owner+month (via allocation_id join)
    const allAllocationIds = activeAllocations.map((a) => a.id);

    // We need all obligation IDs for this month — including orphans from ended/inactive allocations
    const allObligationsForMonth = await prisma.rent_obligations.findMany({
      where: {
        owner_id: ownerId,
        rent_month: rentMonthUTC,
        obligation_type: obligationType,
        // Fetch via owner_id so we catch orphaned obligations too
      },
      select: {
        id: true,
        allocation_id: true,
        tenant_id: true,
      },
    });

    const actualCount = allObligationsForMonth.length;

    // 4. Detect MISSING: eligible allocation has no obligation
    for (const alloc of eligibleAllocations) {
      const hasObligation = allObligationsForMonth.some(
        (o) => o.allocation_id === alloc.id
      );
      if (!hasObligation) {
        anomalies.push({
          type: "MISSING",
          allocation_id: alloc.id,
          tenant_id: (alloc.tenant as any).id,
          message: `No ${obligationType} obligation found for active allocation ${alloc.id}`,
        });
      }
    }

    // 5. Detect DUPLICATE: same allocation_id appears more than once
    const obligationsByAllocation = new Map<string, number>();
    for (const o of allObligationsForMonth) {
      if (!o.allocation_id) continue;
      obligationsByAllocation.set(
        o.allocation_id,
        (obligationsByAllocation.get(o.allocation_id) || 0) + 1
      );
    }
    for (const entry of Array.from(obligationsByAllocation.entries())) {
      const allocId = entry[0];
      const count = entry[1];
      if (count > 1) {
        anomalies.push({
          type: "DUPLICATE",
          allocation_id: allocId,
          obligation_count: count,
          message: `${count} ${obligationType} obligations found for allocation ${allocId} — expected 1`,
        });
      }
    }

    // 6. Detect ORPHAN: obligation exists for an allocation NOT in the active set
    for (const o of allObligationsForMonth) {
      if (!o.allocation_id) continue;
      const isActive = allAllocationIds.includes(o.allocation_id);
      if (!isActive) {
        anomalies.push({
          type: "ORPHAN",
          allocation_id: o.allocation_id,
          tenant_id: o.tenant_id,
          message: `${obligationType} obligation exists for allocation ${o.allocation_id} which is not active for this month`,
        });
      }
    }

    const missingCount = anomalies.filter((a) => a.type === "MISSING").length;
    const duplicateCount = anomalies.filter((a) => a.type === "DUPLICATE").length;
    const orphanCount = anomalies.filter((a) => a.type === "ORPHAN").length;

    let status: ReconciliationStatus = "OK";
    if (duplicateCount > 0) status = "DUPLICATE";
    else if (orphanCount > 0) status = "ORPHAN";
    else if (missingCount > 0) status = "MISSING";
    else if (actualCount !== expectedCount) status = "MISMATCH";

    const durationMs = Date.now() - startTime;

    const result: ReconciliationResult = {
      owner_id: ownerId,
      hostel_id: hostelId,
      rent_month: rentMonthUTC.toISOString(),
      obligation_type: obligationType,
      expected_count: expectedCount,
      actual_count: actualCount,
      missing_count: missingCount,
      duplicate_count: duplicateCount,
      orphan_count: orphanCount,
      status,
      anomalies,
      reconciled_at: new Date().toISOString(),
      duration_ms: durationMs,
    };

    // 7. Emit structured anomaly events for any non-OK result (Phase 7 observability)
    if (status !== "OK") {
      console.warn("[RECONCILE] Anomaly detected", {
        owner_id: ownerId,
        hostel_id: hostelId,
        rent_month: rentMonthUTC.toISOString(),
        obligation_type: obligationType,
        status,
        missing: missingCount,
        duplicates: duplicateCount,
        orphans: orphanCount,
      });

      await eventLog
        .log("RECONCILIATION_FAILED", ownerId, {
          hostel_id: hostelId,
          rent_month: rentMonthUTC.toISOString(),
          obligation_type: obligationType,
          status,
          expected_count: expectedCount,
          actual_count: actualCount,
          missing_count: missingCount,
          duplicate_count: duplicateCount,
          orphan_count: orphanCount,
          anomaly_count: anomalies.length,
        })
        .catch((err) =>
          console.error("[RECONCILE] Failed to write reconciliation event:", err)
        );
    } else {
      console.log("[RECONCILE] OK", {
        owner_id: ownerId,
        hostel_id: hostelId,
        rent_month: rentMonthUTC.toISOString(),
        obligation_type: obligationType,
        expected_count: expectedCount,
        actual_count: actualCount,
        duration_ms: durationMs,
      });
    }

    return result;
  }

  /**
   * Reconcile ALL hostels for a given owner and month.
   * Runs independently per hostel to prevent one failure blocking others.
   *
   * @param ownerId       - The owner whose hostels to reconcile
   * @param rentMonthUTC  - First-of-month UTC date
   */
  async reconcileOwnerMonth(
    ownerId: string,
    rentMonthUTC: Date
  ): Promise<ReconciliationSummary> {
    const startTime = Date.now();

    const hostels = await prisma.hostels.findMany({
      where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true },
    });

    const results: ReconciliationResult[] = [];

    for (const hostel of hostels) {
      // Reconcile RENT obligations
      try {
        const rentResult = await this.reconcileHostelMonth(
          hostel.id,
          ownerId,
          rentMonthUTC,
          "RENT"
        );
        results.push(rentResult);
      } catch (err) {
        console.error("[RECONCILE] Failed to reconcile RENT for hostel", hostel.id, err);
      }

      // Reconcile MAINTENANCE obligations
      try {
        const maintResult = await this.reconcileHostelMonth(
          hostel.id,
          ownerId,
          rentMonthUTC,
          "MAINTENANCE"
        );
        results.push(maintResult);
      } catch (err) {
        console.error("[RECONCILE] Failed to reconcile MAINTENANCE for hostel", hostel.id, err);
      }
    }

    const okCount = results.filter((r) => r.status === "OK").length;
    const failedCount = results.filter((r) => r.status !== "OK").length;
    const totalMissing = results.reduce((s, r) => s + r.missing_count, 0);
    const totalDuplicates = results.reduce((s, r) => s + r.duplicate_count, 0);
    const totalOrphans = results.reduce((s, r) => s + r.orphan_count, 0);

    return {
      rent_month: rentMonthUTC.toISOString(),
      owner_id: ownerId,
      total_hostels: hostels.length,
      ok_count: okCount,
      failed_count: failedCount,
      total_missing: totalMissing,
      total_duplicates: totalDuplicates,
      total_orphans: totalOrphans,
      results,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Nightly cross-owner reconciliation job.
   * Called by the scheduled cron — reconciles all active owners for the current month.
   *
   * @param targetDate - Override the current date (useful for testing)
   */
  async runNightlyReconciliation(
    targetDate?: Date
  ): Promise<ReconciliationSummary> {
    const startTime = Date.now();
    const now = targetDate || new Date();
    const rentMonthUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );

    console.log("[RECONCILE] Starting nightly reconciliation", {
      rent_month: rentMonthUTC.toISOString(),
    });

    // Get all distinct owner IDs that have active hostels
    const activeHostels = await prisma.hostels.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true, owner_id: true },
    });

    const ownerIds = Array.from(
      new Set(activeHostels.map((h) => h.owner_id))
    );

    const allResults: ReconciliationResult[] = [];

    for (const ownerId of ownerIds) {
      try {
        const summary = await this.reconcileOwnerMonth(ownerId, rentMonthUTC);
        allResults.push(...summary.results);
      } catch (err) {
        console.error("[RECONCILE] Failed for owner", ownerId, err);
      }
    }

    const okCount = allResults.filter((r) => r.status === "OK").length;
    const failedCount = allResults.filter((r) => r.status !== "OK").length;
    const totalMissing = allResults.reduce((s, r) => s + r.missing_count, 0);
    const totalDuplicates = allResults.reduce((s, r) => s + r.duplicate_count, 0);
    const totalOrphans = allResults.reduce((s, r) => s + r.orphan_count, 0);

    const summary: ReconciliationSummary = {
      rent_month: rentMonthUTC.toISOString(),
      total_hostels: activeHostels.length,
      ok_count: okCount,
      failed_count: failedCount,
      total_missing: totalMissing,
      total_duplicates: totalDuplicates,
      total_orphans: totalOrphans,
      results: allResults,
      duration_ms: Date.now() - startTime,
    };

    console.log("[RECONCILE] Nightly reconciliation complete", {
      rent_month: rentMonthUTC.toISOString(),
      total_hostels: activeHostels.length,
      ok_count: okCount,
      failed_count: failedCount,
      total_missing: totalMissing,
      total_duplicates: totalDuplicates,
      total_orphans: totalOrphans,
      duration_ms: summary.duration_ms,
    });

    // Emit summary anomaly event if any failures found (Phase 7)
    if (failedCount > 0) {
      await eventLog
        .log("RECONCILIATION_FAILED", null, {
          scope: "NIGHTLY",
          rent_month: rentMonthUTC.toISOString(),
          failed_count: failedCount,
          total_missing: totalMissing,
          total_duplicates: totalDuplicates,
          total_orphans: totalOrphans,
        })
        .catch((err) =>
          console.error("[RECONCILE] Failed to write nightly summary event:", err)
        );
    }

    return summary;
  }
}

export const rentReconciliationService = new RentReconciliationService();
