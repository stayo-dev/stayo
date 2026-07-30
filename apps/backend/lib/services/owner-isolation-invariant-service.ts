import { prisma } from "../db";
import { eventLog } from "./event-log-service";

type OwnerIsolationFailure = {
  type: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  entity_type: string;
  entity_id: string | null;
  owner_id: string | null;
  expected_owner_id?: string | null;
  actual_owner_id?: string | null;
  details?: Record<string, any>;
};

async function query<T = any>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

export class OwnerIsolationInvariantService {
  async runAll() {
    const failures = await this.detectFailures();
    if (failures.length > 0) {
      await eventLog.log("CROSS_OWNER_DATA_LEAK", null, {
        count: failures.length,
        critical_count: failures.filter((f) => f.severity === "CRITICAL").length,
        samples: failures.slice(0, 25),
      });
    }
    return {
      checked_at: new Date().toISOString(),
      failure_count: failures.length,
      failures_by_severity: {
        CRITICAL: failures.filter((f) => f.severity === "CRITICAL").length,
        HIGH: failures.filter((f) => f.severity === "HIGH").length,
        MEDIUM: failures.filter((f) => f.severity === "MEDIUM").length,
      },
      failures,
    };
  }

  async detectFailures(): Promise<OwnerIsolationFailure[]> {
    const checks: Array<{ type: string; severity: OwnerIsolationFailure["severity"]; entity: string; sql: string }> = [
      {
        type: "TENANT_OWNER_HOSTEL_MISMATCH",
        severity: "CRITICAL",
        entity: "Tenant",
        sql: `SELECT t.id, t.owner_id::text AS actual_owner_id, h.owner_id::text AS expected_owner_id, t.hostel_id::text AS hostel_id FROM tenants t JOIN hostels h ON h.id = t.hostel_id WHERE t.owner_id IS DISTINCT FROM h.owner_id LIMIT 500`,
      },
      {
        type: "ROOM_ALLOCATION_OWNER_MISMATCH",
        severity: "CRITICAL",
        entity: "RoomAllocation",
        sql: `SELECT ra.id, t.owner_id::text AS actual_owner_id, h.owner_id::text AS expected_owner_id, ra.hostel_id::text AS hostel_id FROM room_allocations ra JOIN tenants t ON t.id = ra.tenant_id JOIN rooms r ON r.id = ra.room_id JOIN hostels h ON h.id = r.hostel_id WHERE t.owner_id IS DISTINCT FROM h.owner_id LIMIT 500`,
      },
      {
        type: "OBLIGATION_OWNER_HOSTEL_MISMATCH",
        severity: "CRITICAL",
        entity: "RentObligation",
        sql: `SELECT o.id, o.owner_id::text AS actual_owner_id, h.owner_id::text AS expected_owner_id, o.hostel_id::text AS hostel_id FROM rent_obligations o JOIN hostels h ON h.id = o.hostel_id WHERE o.owner_id IS DISTINCT FROM h.owner_id LIMIT 500`,
      },
      {
        type: "PAYMENT_OWNER_HOSTEL_MISMATCH",
        severity: "CRITICAL",
        entity: "Payment",
        sql: `SELECT p.id, p.owner_id::text AS actual_owner_id, h.owner_id::text AS expected_owner_id, p.hostel_id::text AS hostel_id FROM payments p JOIN hostels h ON h.id = p.hostel_id WHERE p.owner_id IS DISTINCT FROM h.owner_id LIMIT 500`,
      },
      {
        type: "RECEIPT_OWNER_HOSTEL_MISMATCH",
        severity: "HIGH",
        entity: "Receipt",
        sql: `SELECT r.id, r.owner_id::text AS actual_owner_id, h.owner_id::text AS expected_owner_id, r.hostel_id::text AS hostel_id FROM receipts r JOIN hostels h ON h.id = r.hostel_id WHERE r.owner_id IS DISTINCT FROM h.owner_id LIMIT 500`,
      },
      {
        type: "EXPENSE_OWNER_HOSTEL_MISMATCH",
        severity: "HIGH",
        entity: "Expense",
        sql: `SELECT e.id, e.owner_id::text AS actual_owner_id, h.owner_id::text AS expected_owner_id, e.hostel_id::text AS hostel_id FROM expenses e JOIN hostels h ON h.id = e.hostel_id WHERE e.owner_id IS DISTINCT FROM h.owner_id LIMIT 500`,
      },
    ];

    const failures: OwnerIsolationFailure[] = [];
    for (const check of checks) {
      const rows = await query<any>(check.sql);
      failures.push(...rows.map((r) => ({
        type: check.type,
        severity: check.severity,
        entity_type: check.entity,
        entity_id: r.id,
        owner_id: r.actual_owner_id,
        expected_owner_id: r.expected_owner_id,
        actual_owner_id: r.actual_owner_id,
        details: { hostel_id: r.hostel_id },
      })));
    }
    return failures;
  }
}

export const ownerIsolationInvariantService = new OwnerIsolationInvariantService();
