/**
 * RentGenerationService — Phase 1 + Phase 2 + Phase 3 reliability tests
 *
 * Run:
 *   DOTENV_CONFIG_PATH=../../.env node -r dotenv/config ./node_modules/.bin/tsx lib/services/rent-generation-service.test.ts
 *
 * No real DB is touched. Prisma is patched in-memory.
 *
 * Phase 3 additions:
 *   - $transaction mock with atomic commit / rollback simulation
 *   - failMaintCreateMany: simulates maintenance insert failure after rent succeeds
 *   - txRollbackAfterRent: simulates DB error mid-transaction (after first createMany)
 *   - Tests: full rollback on partial failure, retry success, concurrent duplicate safety
 */

import { prisma } from "../db";
import { eventSystem } from "../events";
import { eventLog } from "./event-log-service";
import { getDayInTimezone } from "../timezone";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  OK ${name}`);
    passed++;
  } else {
    const msg = `  FAIL ${name}${detail ? ` — ${detail}` : ""}`;
    console.error(msg);
    failures.push(msg);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

type Hostel = {
  id: string;
  owner_id: string;
  is_active: boolean;
  auto_rent_day: number;
  timezone: string;
  preferences_config?: any;
};

type Allocation = {
  id: string;
  is_active: boolean;
  start_date: Date;
  end_date: Date | null;
  tenant: {
    id: string;
    monthly_rent: number;
    owner_id: string;
    status: string;
    maintenance_charge?: number;
    maintenance_type?: string;
  };
  room: { base_rent: number; hostel_id: string };
};

type Obligation = {
  tenant_id: string;
  allocation_id: string;
  owner_id: string;
  rent_month: Date;
  amount: number;
  total_amount: number;
  due_date: Date;
  status: string;
  obligation_type: string;
};

type Ledger = {
  owner_id: string;
  hostel_id: string;
  rent_month: Date;
  obligation_type: string;
  status: string;
  trigger_type?: string | null;
  generated_by?: string | null;
  created_count: number;
  skipped_count: number;
  failure_reason?: string | null;
  started_at?: Date | null;
  completed_at?: Date | null;
};

const state = {
  hostels: [] as Hostel[],
  allocations: [] as Allocation[],
  obligations: [] as Obligation[],
  ledgers: [] as Ledger[],
  logs: [] as any[],
  eventLogs: [] as any[],        // Phase 7: captures eventLog.log() calls
  lockLog: [] as string[],       // Phase 5: captures lock key used
  failCreateMany: false,
  failMaintCreateMany: false,
  txRollbackAfterRent: false,
  failRentGenerationLog: false,
};

function resetState() {
  state.hostels = [];
  state.allocations = [];
  state.obligations = [];
  state.ledgers = [];
  state.logs = [];
  state.eventLogs = [];
  state.lockLog = [];
  state.failCreateMany = false;
  state.failMaintCreateMany = false;
  state.txRollbackAfterRent = false;
  state.failRentGenerationLog = false;
}

function sameDate(a: Date, b: Date) {
  return +a === +b;
}

function ledgerWhere(where: any) {
  return where.owner_id_hostel_id_rent_month_obligation_type;
}

function findLedger(where: any) {
  const s = ledgerWhere(where);
  return state.ledgers.find((l) =>
    l.owner_id === s.owner_id &&
    l.hostel_id === s.hostel_id &&
    sameDate(l.rent_month, s.rent_month) &&
    l.obligation_type === s.obligation_type
  ) || null;
}

function applyLedgerUpdate(row: Ledger, data: any) {
  for (const [key, value] of Object.entries(data)) {
    if (key === "skipped_count" && value && typeof value === "object" && "increment" in value) {
      row.skipped_count += Number((value as any).increment);
    } else {
      (row as any)[key] = value;
    }
  }
  return row;
}

(prisma as any).$executeRaw = async (strings: any, ...values: any[]) => {
  // Phase 5: Capture the lock key used so tests can assert on its format
  if (strings && strings[0] && String(strings[0]).includes("system_locks")) {
    const lockKeyVal = values[0];
    if (lockKeyVal && typeof lockKeyVal === "string") state.lockLog.push(lockKeyVal);
  }
  return 1;
};

// Phase 3: $transaction mock — implements Prisma interactive transaction semantics.
// The callback receives a `tx` proxy that buffers writes to a staging area.
// On success: staging is merged into state.obligations (commit).
// On failure: staging is discarded (rollback).
// This correctly simulates atomic all-or-nothing behavior.
(prisma as any).$transaction = async (fn: (tx: any) => Promise<any>) => {
  const staged: Obligation[] = [];
  let maintCallCount = 0;

  const tx = {
    rentObligation: {
      createMany: async ({ data, skipDuplicates }: any) => {
        if (state.failCreateMany) throw new Error("SIMULATED_CREATE_MANY_FAILURE");

        // Determine if this is the maintenance batch (second createMany call in tx)
        maintCallCount++;
        const isMaintBatch = data.length > 0 && data[0].obligation_type === "MAINTENANCE";
        if (state.failMaintCreateMany && isMaintBatch) {
          throw new Error("SIMULATED_MAINT_CREATE_MANY_FAILURE");
        }
        if (state.txRollbackAfterRent && maintCallCount === 2) {
          throw new Error("SIMULATED_TX_MID_FAILURE");
        }

        let count = 0;
        for (const row of data) {
          // Check against already-committed obligations AND current tx staging
          const allObs = [...state.obligations, ...staged];
          const dup = allObs.some((o) =>
            o.allocation_id === row.allocation_id &&
            sameDate(o.rent_month, row.rent_month) &&
            o.obligation_type === (row.obligation_type ?? "RENT")
          );
          if (dup && skipDuplicates) continue;
          if (dup) {
            const err: any = new Error("Unique constraint failed");
            err.code = "P2002";
            throw err;
          }
          staged.push({ ...row, obligation_type: row.obligation_type ?? "RENT" });
          count++;
        }
        return { count };
      },
    },
  };

  try {
    const result = await fn(tx);
    // Commit: merge staging into the committed state
    state.obligations.push(...staged);
    return result;
  } catch (err) {
    // Rollback: staged writes are discarded — nothing is pushed to state.obligations
    throw err;
  }
};

(prisma as any).roomAllocation = {
  findMany: async ({ where }: any) => state.allocations.filter((a) => {
    if (where.is_active !== undefined && a.is_active !== where.is_active) return false;
    if (where.start_date?.lte && a.start_date > where.start_date.lte) return false;
    if (where.tenant?.status && a.tenant.status !== where.tenant.status) return false;
    if (where.tenant?.owner_id && a.tenant.owner_id !== where.tenant.owner_id) return false;
    if (where.OR) {
      const monthStart: Date = where.OR[1].end_date.gte;
      if (!(a.end_date === null || a.end_date >= monthStart)) return false;
    }
    return true;
  }),
};

(prisma as any).hostel = {
  findMany: async ({ where }: any) => {
    const ownerIds: string[] | undefined = where.owner_id?.in;
    const hostelIds: string[] | undefined = where.id?.in;
    return state.hostels.filter((h) => {
      if (ownerIds && !ownerIds.includes(h.owner_id)) return false;
      if (hostelIds && !hostelIds.includes(h.id)) return false;
      return h.is_active === (where.is_active ?? true);
    });
  },
};

(prisma as any).rentObligation = {
  findMany: async ({ where }: any) => {
    const ids: string[] = where.allocation_id?.in || [];
    return state.obligations.filter((o) =>
      ids.includes(o.allocation_id) &&
      sameDate(o.rent_month, where.rent_month)
    );
  },
  // Direct createMany is still needed for non-transactional paths in tests (none currently).
  // The transaction path uses tx.rent_obligations.createMany above.
  createMany: async ({ data, skipDuplicates }: any) => {
    if (state.failCreateMany) throw new Error("SIMULATED_CREATE_MANY_FAILURE");
    let count = 0;
    for (const row of data) {
      const dup = state.obligations.some((o) =>
        o.allocation_id === row.allocation_id &&
        sameDate(o.rent_month, row.rent_month) &&
        o.obligation_type === (row.obligation_type ?? "RENT")
      );
      if (dup && skipDuplicates) continue;
      if (dup) {
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        throw err;
      }
      state.obligations.push({ ...row, obligation_type: row.obligation_type ?? "RENT" });
      count++;
    }
    return { count };
  },
};

(prisma as any).rentGenerationLedger = {
  findUnique: async ({ where, select }: any) => {
    const row = findLedger(where);
    if (!row || !select) return row;
    return Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));
  },
  create: async ({ data }: any) => {
    const exists = state.ledgers.some((l) =>
      l.owner_id === data.owner_id &&
      l.hostel_id === data.hostel_id &&
      sameDate(l.rent_month, data.rent_month) &&
      l.obligation_type === data.obligation_type
    );
    if (exists) {
      const err: any = new Error("Unique constraint failed");
      err.code = "P2002";
      throw err;
    }
    const row = {
      created_count: 0,
      skipped_count: 0,
      ...data,
    };
    state.ledgers.push(row);
    return row;
  },
  update: async ({ where, data }: any) => {
    const row = findLedger(where);
    if (!row) throw new Error("Ledger not found");
    return applyLedgerUpdate(row, data);
  },
  upsert: async ({ where, create, update }: any) => {
    const row = findLedger(where);
    if (row) return applyLedgerUpdate(row, update);
    const created = {
      created_count: 0,
      skipped_count: 0,
      ...create,
    };
    state.ledgers.push(created);
    return created;
  },
};

(prisma as any).rentGenerationLog = {
  create: async ({ data }: any) => {
    if (state.failRentGenerationLog) throw new Error("SIMULATED_LOG_FAILURE");
    state.logs.push(data);
    return data;
  },
};

(eventSystem as any).trigger = async () => {};
(eventLog as any).log = async (eventType: string, ownerId: any, metadata: any) => {
  state.eventLogs.push({ eventType, ownerId, metadata });
};
import { RentGenerationService } from "./rent-generation-service";

const rawService = new RentGenerationService();
const service = {
  generateMonthlyRent(
    targetDate: Date | undefined,
    ownerId: string | undefined,
    triggerType: "cron" | "manual" = "manual",
    hostelId?: string,
  ) {
    const resolvedOwnerId = ownerId || state.hostels.at(0)?.owner_id;
    const resolvedHostelId =
      hostelId || state.hostels.find((hostel) => hostel.owner_id === resolvedOwnerId)?.id;
    if (!resolvedOwnerId || !resolvedHostelId) {
      throw new Error("Test fixture missing owner/hostel context");
    }
    return rawService.generateMonthlyRent(targetDate, resolvedOwnerId, triggerType, resolvedHostelId);
  },
  previewMonthlyRent(targetDate: Date | undefined, ownerId: string, hostelId: string) {
    return rawService.previewMonthlyRent(targetDate, ownerId, hostelId);
  },
};

function seedOwner(opts: {
  ownerId: string;
  hostelId?: string;
  autoRentDay: number;
  timezone?: string;
  autoGenerateRent?: boolean;
  monthlyRent?: number;
  maintenanceCharge?: number;
  dueDay?: number;
  isActive?: boolean;
  rentCycle?: string;
}) {
  const hostelId = opts.hostelId || `hostel-${opts.ownerId}`;
  const fixtureId = opts.hostelId ? `${opts.ownerId}-${hostelId}` : opts.ownerId;
  state.hostels.push({
    id: hostelId,
    owner_id: opts.ownerId,
    is_active: opts.isActive ?? true,
    auto_rent_day: opts.autoRentDay,
    timezone: opts.timezone || "Asia/Kolkata",
    preferences_config: {
      auto_generate_rent: opts.autoGenerateRent ?? true,
      due_day: opts.dueDay ?? 5,
      rent_cycle: opts.rentCycle ?? "MONTHLY",
    },
  });
  state.allocations.push({
    id: `alloc-${fixtureId}`,
    is_active: true,
    start_date: new Date("2026-01-01T00:00:00Z"),
    end_date: null,
    tenant: {
      id: `tenant-${fixtureId}`,
      owner_id: opts.ownerId,
      status: "ACTIVE",
      monthly_rent: opts.monthlyRent ?? 5000,
      maintenance_charge: opts.maintenanceCharge ?? 0,
      maintenance_type: "MONTHLY",
    },
    room: { base_rent: 5000, hostel_id: hostelId },
  });
}

function ledger(ownerId: string, obligationType = "RENT") {
  return state.ledgers.find((l) => l.owner_id === ownerId && l.obligation_type === obligationType);
}

function ledgerForHostel(hostelId: string, obligationType = "RENT") {
  return state.ledgers.find((l) => l.hostel_id === hostelId && l.obligation_type === obligationType);
}

async function testTimezoneHelper() {
  console.log("\ngetDayInTimezone");
  assertEq(getDayInTimezone(new Date("2026-04-30T19:00:00Z"), "Asia/Kolkata"), 1, "IST boundary reaches May 1");
  assertEq(getDayInTimezone(new Date("2026-04-30T19:00:00Z"), "UTC"), 30, "UTC remains April 30");
}

async function testExactDayCreatesAndCompletesLedger() {
  console.log("\ncron exact day creates and completes ledger");
  resetState();
  seedOwner({ ownerId: "A", autoRentDay: 1 });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-01T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 1, "created one obligation");
  assertEq(state.obligations.length, 1, "stored one obligation");
  assertEq(ledger("A")?.status, "COMPLETED", "ledger completed");
  assertEq(ledger("A")?.created_count, 1, "ledger created count");
}

async function testCatchUpAfterMissedDay() {
  console.log("\ncron catch-up after missed day");
  resetState();
  seedOwner({ ownerId: "C", autoRentDay: 1 });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-04T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 1, "catch-up creates obligation");
  assertEq(ledger("C")?.status, "COMPLETED", "catch-up completes ledger");
}

async function testCompletedLedgerSkips() {
  console.log("\ncompleted ledger skips duplicate generation");
  resetState();
  seedOwner({ ownerId: "D", autoRentDay: 1 });
  state.ledgers.push({
    owner_id: "D",
    hostel_id: "hostel-D",
    rent_month: new Date(Date.UTC(2026, 4, 1)),
    obligation_type: "RENT",
    status: "COMPLETED",
    created_count: 1,
    skipped_count: 0,
  });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-04T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 0, "created zero");
  assertEq(state.obligations.length, 0, "no duplicate obligation");
  assertEq(ledger("D")?.status, "COMPLETED", "ledger remains completed");
}

async function testBeforeGenerationDaySkips() {
  console.log("\ncron before generation day skips");
  resetState();
  seedOwner({ ownerId: "B", autoRentDay: 5 });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-01T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 0, "created zero before day");
  assertEq(ledger("B")?.status, "SKIPPED", "ledger records skip");
  assertEq(ledger("B")?.failure_reason, "BEFORE_GENERATION_DAY", "skip reason");
}

async function testAutoGenerateOffSkips() {
  console.log("\nauto_generate_rent=false skips");
  resetState();
  seedOwner({ ownerId: "OFF", autoRentDay: 1, autoGenerateRent: false });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 0, "created zero");
  assertEq(ledger("OFF")?.status, "SKIPPED", "ledger skipped");
  assertEq(ledger("OFF")?.failure_reason, "AUTO_GENERATE_DISABLED", "skip reason");
}

async function testExistingObligationWithoutLedgerCompletes() {
  console.log("\nexisting obligation without ledger is idempotent and completes ledger");
  resetState();
  seedOwner({ ownerId: "I", autoRentDay: 1 });
  state.obligations.push({
    tenant_id: "tenant-I",
    allocation_id: "alloc-I",
    owner_id: "I",
    rent_month: new Date(Date.UTC(2026, 4, 1)),
    amount: 5000,
    total_amount: 5000,
    due_date: new Date(Date.UTC(2026, 4, 5)),
    status: "PENDING",
    obligation_type: "RENT",
  });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 0, "created zero duplicate rows");
  assertEq(state.obligations.length, 1, "still one obligation");
  assertEq(ledger("I")?.status, "COMPLETED", "ledger completed for existing row");
  assertEq(ledger("I")?.skipped_count, 1, "ledger records skipped existing row");
}

async function testMaintenanceLedgerIndependent() {
  console.log("\nrent and maintenance ledgers are independent");
  resetState();
  seedOwner({ ownerId: "M", autoRentDay: 1, maintenanceCharge: 750 });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 2, "created rent and maintenance");
  assertEq(ledger("M", "RENT")?.status, "COMPLETED", "rent ledger completed");
  assertEq(ledger("M", "MAINTENANCE")?.status, "COMPLETED", "maintenance ledger completed");
}

async function testMultiHostelIndependentGenerationDays() {
  console.log("\nmulti-hostel generation days are independent");
  resetState();
  seedOwner({ ownerId: "MH", hostelId: "hostel-A", autoRentDay: 1, monthlyRent: 1000, dueDay: 3 });
  seedOwner({ ownerId: "MH", hostelId: "hostel-B", autoRentDay: 5, monthlyRent: 2000, dueDay: 7 });
  seedOwner({ ownerId: "MH", hostelId: "hostel-C", autoRentDay: 10, monthlyRent: 3000, dueDay: 11 });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-05T06:00:00Z"), undefined, "cron");
  const allocationIds = state.obligations.map((o) => o.allocation_id).sort();

  assertEq(summary.created, 2, "created only due hostels");
  assertEq(allocationIds.join(","), "alloc-MH-hostel-A,alloc-MH-hostel-B", "hostel A catch-up and B exact-day generated");
  assertEq(ledgerForHostel("hostel-A")?.status, "COMPLETED", "hostel A completed");
  assertEq(ledgerForHostel("hostel-B")?.status, "COMPLETED", "hostel B completed");
  assertEq(ledgerForHostel("hostel-C")?.status, "SKIPPED", "hostel C skipped");
  assertEq(ledgerForHostel("hostel-C")?.failure_reason, "BEFORE_GENERATION_DAY", "hostel C skip reason");
  assertEq(
    state.obligations.find((o) => o.allocation_id === "alloc-MH-hostel-A")?.due_date.toISOString(),
    "2026-05-03T00:00:00.000Z",
    "hostel A due day applied"
  );
  assertEq(
    state.obligations.find((o) => o.allocation_id === "alloc-MH-hostel-B")?.due_date.toISOString(),
    "2026-05-07T00:00:00.000Z",
    "hostel B due day applied"
  );
}

async function testMultiHostelCompletedLedgerOnlySkipsMatchingHostel() {
  console.log("\ncompleted ledger only skips matching hostel");
  resetState();
  seedOwner({ ownerId: "MS", hostelId: "hostel-old", autoRentDay: 1, monthlyRent: 1000 });
  seedOwner({ ownerId: "MS", hostelId: "hostel-open", autoRentDay: 1, monthlyRent: 2000 });
  state.ledgers.push({
    owner_id: "MS",
    hostel_id: "hostel-old",
    rent_month: new Date(Date.UTC(2026, 4, 1)),
    obligation_type: "RENT",
    status: "COMPLETED",
    created_count: 1,
    skipped_count: 0,
  });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 1, "created only non-completed hostel");
  assertEq(state.obligations[0]?.allocation_id, "alloc-MS-hostel-open", "open hostel generated");
  assertEq(ledgerForHostel("hostel-old")?.status, "COMPLETED", "old hostel remains completed");
  assertEq(ledgerForHostel("hostel-open")?.status, "COMPLETED", "open hostel completed");
}

async function testInactiveHostelDoesNotGenerate() {
  console.log("\ninactive hostel does not generate");
  resetState();
  seedOwner({ ownerId: "IH", hostelId: "hostel-inactive", autoRentDay: 1, isActive: false });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 0, "created zero");
  assertEq(state.obligations.length, 0, "no obligation created");
  assertEq(ledgerForHostel("hostel-inactive")?.status, "SKIPPED", "inactive hostel skip recorded");
  assertEq(ledgerForHostel("hostel-inactive")?.failure_reason, "ACTIVE_HOSTEL_NOT_FOUND", "inactive hostel skip reason");
}

async function testCreateFailureMarksLedgerFailedAndRetryWorks() {
  console.log("\ncreate failure marks failed and retry works");
  resetState();
  seedOwner({ ownerId: "R", autoRentDay: 1 });
  state.failCreateMany = true;

  try {
    await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  } catch {
    // expected
  }
  assertEq(ledger("R")?.status, "FAILED", "ledger failed after insert failure");

  state.failCreateMany = false;
  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  assertEq(summary.created, 1, "retry creates row");
  assertEq(ledger("R")?.status, "COMPLETED", "retry completes ledger");
}

async function testLogFailureDoesNotCorruptGeneration() {
  console.log("\nlog failure does not corrupt generation");
  resetState();
  seedOwner({ ownerId: "L", autoRentDay: 1 });
  state.failRentGenerationLog = true;

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 1, "obligation still created");
  assertEq(ledger("L")?.status, "COMPLETED", "ledger still completed");
}

// ── Phase 3: Transactional Safety Tests ──────────────────────────────────────

async function testMaintFailureRollsBackEntireTransaction() {
  console.log("\n[P3] maintenance insert failure rolls back entire transaction (no partial state)");
  resetState();
  // Tenant has both rent AND maintenance — both go into the same transaction
  seedOwner({ ownerId: "TX", autoRentDay: 1, maintenanceCharge: 500 });
  state.failMaintCreateMany = true;

  try {
    await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  } catch {
    // expected — transaction throws
  }

  // Critical assertion: the transaction rolled back, so NO obligations exist
  // (rent rows must also be absent — they were part of the same transaction)
  assertEq(state.obligations.length, 0, "[P3] zero obligations after rollback — no partial state");
  assertEq(ledger("TX", "RENT")?.status, "FAILED", "[P3] rent ledger marked FAILED");
  assertEq(ledger("TX", "MAINTENANCE")?.status, "FAILED", "[P3] maintenance ledger marked FAILED");
  assert(
    ledger("TX", "RENT")?.failure_reason === "TRANSACTION_ROLLED_BACK" ||
    ledger("TX", "MAINTENANCE")?.failure_reason === "TRANSACTION_ROLLED_BACK",
    "[P3] failure reason is TRANSACTION_ROLLED_BACK"
  );
}

async function testTransactionRetryAfterRollbackSucceeds() {
  console.log("\n[P3] retry after transaction rollback creates all obligations atomically");
  resetState();
  seedOwner({ ownerId: "TXR", autoRentDay: 1, maintenanceCharge: 500 });
  state.failMaintCreateMany = true;

  // First attempt: should roll back
  try {
    await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  } catch {
    // expected
  }
  assertEq(state.obligations.length, 0, "[P3] retry-before: no obligations");
  assertEq(ledger("TXR", "RENT")?.status, "FAILED", "[P3] retry-before: rent ledger FAILED");

  // Restore DB health and retry
  state.failMaintCreateMany = false;
  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");

  assertEq(summary.created, 2, "[P3] retry creates both rent and maintenance");
  assertEq(state.obligations.length, 2, "[P3] both obligations committed after retry");
  assertEq(ledger("TXR", "RENT")?.status, "COMPLETED", "[P3] rent ledger COMPLETED after retry");
  assertEq(ledger("TXR", "MAINTENANCE")?.status, "COMPLETED", "[P3] maintenance ledger COMPLETED after retry");
}

async function testConcurrentDuplicateSafeUnderTransaction() {
  console.log("\n[P3] concurrent duplicate retry is idempotent inside transaction (skipDuplicates)");
  resetState();
  seedOwner({ ownerId: "TXD", autoRentDay: 1 });

  // First run succeeds — rent obligation committed
  const first: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  assertEq(first.created, 1, "[P3] first run creates obligation");
  assertEq(state.obligations.length, 1, "[P3] one obligation committed");

  // Simulate a concurrent second trigger: ledger is COMPLETED so it short-circuits at the
  // hasCompleted check. But if ledger state were somehow not COMPLETED (e.g. redis lag),
  // the transaction's skipDuplicates prevents double-insert.
  // We test this by manually resetting the ledger status back to STARTED.
  const existingLedger = ledger("TXD", "RENT");
  if (existingLedger) existingLedger.status = "STARTED";

  const second: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  assertEq(second.created, 0, "[P3] concurrent duplicate skipped by skipDuplicates");
  assertEq(state.obligations.length, 1, "[P3] still only one obligation — no duplicate");
  assertEq(ledger("TXD", "RENT")?.status, "COMPLETED", "[P3] ledger completed after idempotent retry");
}

// ── Phase 4: Validation Hardening integration tests ──────────────────────────

async function testInvalidAutoRentDaySkipsWithStructuredReason() {
  console.log("\n[P4] invalid auto_rent_day skips with INVALID_BILLING_CONFIG");
  resetState();
  // auto_rent_day=0 must be in preferences_config — resolvePreferences spreads it
  // unconditionally (the typed hostel.auto_rent_day column has a falsy guard).
  state.hostels.push({
    id: "hostel-P4A", owner_id: "P4A", is_active: true,
    auto_rent_day: 1,   // typed column (valid, will be overridden by config blob)
    timezone: "Asia/Kolkata",
    preferences_config: { auto_generate_rent: true, due_day: 5, rent_cycle: "MONTHLY", auto_rent_day: 0 }, // invalid
  } as any);
  state.allocations.push({
    id: "alloc-P4A", is_active: true, start_date: new Date("2026-01-01T00:00:00Z"), end_date: null,
    tenant: { id: "t-P4A", owner_id: "P4A", status: "ACTIVE", monthly_rent: 5000, maintenance_charge: 0, maintenance_type: "MONTHLY" },
    room: { base_rent: 5000, hostel_id: "hostel-P4A" },
  } as any);

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  assertEq(summary.created, 0, "[P4] zero created for invalid auto_rent_day");
  assertEq(summary.skipped, 1, "[P4] one skipped");
  const l = ledgerForHostel("hostel-P4A");
  assert(!!l, "[P4] ledger written for invalid config");
  assertEq(l?.status, "SKIPPED", "[P4] ledger SKIPPED");
  assert(l?.failure_reason?.startsWith("INVALID_BILLING_CONFIG") ?? false, "[P4] failure_reason starts with INVALID_BILLING_CONFIG");
}

async function testInvalidTimezoneSkips() {
  console.log("\n[P4] invalid timezone skips with INVALID_BILLING_CONFIG");
  resetState();
  state.hostels.push({
    id: "hostel-P4B", owner_id: "P4B", is_active: true,
    auto_rent_day: 1,
    timezone: "Not/ATimezone",   // invalid IANA tz
    preferences_config: { auto_generate_rent: true, due_day: 5, rent_cycle: "MONTHLY" },
  } as any);
  state.allocations.push({
    id: "alloc-P4B", is_active: true, start_date: new Date("2026-01-01T00:00:00Z"), end_date: null,
    tenant: { id: "t-P4B", owner_id: "P4B", status: "ACTIVE", monthly_rent: 5000, maintenance_charge: 0, maintenance_type: "MONTHLY" },
    room: { base_rent: 5000, hostel_id: "hostel-P4B" },
  } as any);

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  assertEq(summary.created, 0, "[P4] zero created for invalid timezone");
  const l = ledgerForHostel("hostel-P4B");
  assert(l?.failure_reason?.includes("INVALID_TIMEZONE") ?? false, "[P4] INVALID_TIMEZONE in reason");
}

async function testDueDayBeforeRentDayShiftsToNextMonth() {
  console.log("\n[P4] due_day < auto_rent_day shifts due date to next month");
  resetState();
  // auto_rent_day=10, due_day=3 → due date pushed to June 3
  seedOwner({ ownerId: "P4C", autoRentDay: 10, dueDay: 3 });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-10T06:00:00Z"), undefined, "cron");
  assertEq(summary.created, 1, "[P4] obligation created");
  const ob = state.obligations[0];
  assertEq(ob?.due_date.toISOString(), "2026-06-03T00:00:00.000Z", "[P4] due date shifted to next month");
}

async function testUnsupportedRentCycleSkips() {
  console.log("\n[P4] unsupported rent_cycle skips generation");
  resetState();
  seedOwner({ ownerId: "P4D", autoRentDay: 1, rentCycle: "WEEKLY" });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  assertEq(summary.created, 0, "[P4] zero created for WEEKLY cycle");
  const l = ledgerForHostel("hostel-P4D");
  assert(l?.failure_reason?.includes("UNSUPPORTED_RENT_CYCLE") ?? false, "[P4] UNSUPPORTED_RENT_CYCLE in reason");
}

// ── Phase 5: Unified Locking ──────────────────────────────────────────────────

async function testLockKeyIsHostelAndMonthScoped() {
  console.log("\n[P5] lock key is hostel+month scoped");
  resetState();
  seedOwner({ ownerId: "P5A", autoRentDay: 1 });

  await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), "P5A", "manual");
  const lockKey = state.lockLog[0];
  assert(!!lockKey, "[P5] lock key captured");
  assert(lockKey.startsWith("rent_gen_hostel-P5A_"), "[P5] lock key starts with rent_gen_<hostelId>");
  assert(lockKey.includes("2026-05"), "[P5] lock key contains YYYY-MM month");
  assert(!lockKey.includes("T00:00:00.000Z"), "[P5] lock key does NOT use ISO datetime (uses YYYY-MM)");
}

async function testLockKeyForCronIsHostelScoped() {
  console.log("\n[P5] cron uses rent_gen_<hostelId>_<YYYY-MM> key");
  resetState();
  seedOwner({ ownerId: "P5B", autoRentDay: 1 });

  await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), undefined, "cron");
  const lockKey = state.lockLog[0];
  assert(lockKey?.startsWith("rent_gen_hostel-P5B_"), "[P5] cron lock key is hostel-scoped");
}

async function testLockContentionEmitsEvent() {
  console.log("\n[P5] lock=0 emits LOCK_CONTENTION event");
  resetState();
  seedOwner({ ownerId: "P5C", autoRentDay: 1 });

  // Override $executeRaw to return 0 (lock held) on first INSERT call
  let lockCallCount = 0;
  (prisma as any).$executeRaw = async (strings: any, ...values: any[]) => {
    if (strings && String(strings[0]).includes("system_locks")) {
      lockCallCount++;
      if (lockCallCount === 1) return 0; // simulate lock held
      return 1;
    }
    return 1;
  };

  const result: any = await service.generateMonthlyRent(new Date("2026-05-02T06:00:00Z"), "P5C", "cron");
  assert(result.locked === true, "[P5] returns locked=true");
  const event = state.eventLogs.find((e: any) => e.eventType === "LOCK_CONTENTION");
  assert(!!event, "[P5] LOCK_CONTENTION event emitted");
  assertEq(event.ownerId, "P5C", "[P5] event ownerId correct");

  // Restore
  (prisma as any).$executeRaw = async (strings: any, ...values: any[]) => {
    if (strings && String(strings[0]).includes("system_locks")) {
      const lockKeyVal = values[0];
      if (lockKeyVal && typeof lockKeyVal === "string") state.lockLog.push(lockKeyVal);
    }
    return 1;
  };
}

// ── Phase 7: Observability ────────────────────────────────────────────────────

async function testZeroRentGeneratedEventEmittedWhenAllSkipped() {
  console.log("\n[P7] ZERO_RENT_GENERATED event emitted when allocations present but all skipped");
  resetState();
  // A completed ledger means the allocation will be skipped by the hasCompleted check
  seedOwner({ ownerId: "P7A", autoRentDay: 1 });
  state.ledgers.push({
    owner_id: "P7A", hostel_id: "hostel-P7A",
    rent_month: new Date(Date.UTC(2026, 4, 1)),
    obligation_type: "RENT", status: "COMPLETED",
    created_count: 1, skipped_count: 0,
  });

  const summary: any = await service.generateMonthlyRent(new Date("2026-05-04T06:00:00Z"), undefined, "cron");
  assertEq(summary.created, 0, "[P7] zero created");
  // ZERO_RENT_GENERATED should NOT fire when all skipped because ledger is completed
  // (failed===0 and allocations.length>0 and created===0 → event fires)
  const event = state.eventLogs.find((e: any) => e.eventType === "ZERO_RENT_GENERATED");
  assert(!!event, "[P7] ZERO_RENT_GENERATED event emitted");
}

async function main() {
  await testTimezoneHelper();
  await testExactDayCreatesAndCompletesLedger();
  await testCatchUpAfterMissedDay();
  await testCompletedLedgerSkips();
  await testBeforeGenerationDaySkips();
  await testAutoGenerateOffSkips();
  await testExistingObligationWithoutLedgerCompletes();
  await testMaintenanceLedgerIndependent();
  await testMultiHostelIndependentGenerationDays();
  await testMultiHostelCompletedLedgerOnlySkipsMatchingHostel();
  await testInactiveHostelDoesNotGenerate();
  await testCreateFailureMarksLedgerFailedAndRetryWorks();
  await testLogFailureDoesNotCorruptGeneration();
  // Phase 3: Transactional Safety
  await testMaintFailureRollsBackEntireTransaction();
  await testTransactionRetryAfterRollbackSucceeds();
  await testConcurrentDuplicateSafeUnderTransaction();
  // Phase 4: Validation Hardening
  await testInvalidAutoRentDaySkipsWithStructuredReason();
  await testInvalidTimezoneSkips();
  await testDueDayBeforeRentDayShiftsToNextMonth();
  await testUnsupportedRentCycleSkips();
  // Phase 5: Unified Locking
  await testLockKeyIsHostelAndMonthScoped();
  await testLockKeyForCronIsHostelScoped();
  await testLockContentionEmitsEvent();
  // Phase 7: Observability
  await testZeroRentGeneratedEventEmittedWhenAllSkipped();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
