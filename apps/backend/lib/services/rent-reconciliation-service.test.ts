/**
 * Phase 6 — Rent Reconciliation Engine Tests
 *
 * Run:
 *   DOTENV_CONFIG_PATH=../../.env node -r dotenv/config ./node_modules/.bin/tsx lib/services/rent-reconciliation-service.test.ts
 *
 * No real DB — Prisma is patched in-memory.
 */

import { prisma } from "../db";
import { eventLog } from "./event-log-service";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.log(`  OK ${name}`); passed++; }
  else {
    const msg = `  FAIL ${name}${detail ? ` — ${detail}` : ""}`;
    console.error(msg); failures.push(msg); failed++;
  }
}
function assertEq<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── In-memory state ───────────────────────────────────────────────────────────

type Allocation = {
  id: string;
  is_active: boolean;
  start_date: Date;
  end_date: Date | null;
  tenant: { id: string; owner_id: string; status: string; monthly_rent: number; maintenance_charge: number; maintenance_type: string };
  room: { hostel_id: string };
};
type Obligation = {
  id: string;
  allocation_id: string | null;
  tenant_id: string;
  owner_id: string;
  rent_month: Date;
  obligation_type: string;
};

const state = {
  allocations: [] as Allocation[],
  obligations: [] as Obligation[],
  hostels: [] as { id: string; owner_id: string; is_active: boolean }[],
  eventLogs: [] as any[],
};

function resetState() {
  state.allocations = [];
  state.obligations = [];
  state.hostels = [];
  state.eventLogs = [];
}

function sameDate(a: Date, b: Date) { return +a === +b; }

const RENT_MONTH = new Date("2026-05-01T00:00:00Z");
const MONTH_END  = new Date("2026-05-31T23:59:59.999Z");

// ── Prisma mocks ──────────────────────────────────────────────────────────────

(prisma as any).roomAllocation = {
  findMany: async ({ where }: any) => {
    return state.allocations.filter(a => {
      if (where.is_active !== undefined && a.is_active !== where.is_active) return false;
      if (where.start_date?.lte && a.start_date > where.start_date.lte) return false;
      if (where.tenant?.status && a.tenant.status !== where.tenant.status) return false;
      if (where.tenant?.owner_id && a.tenant.owner_id !== where.tenant.owner_id) return false;
      if (where.room?.hostel_id && a.room.hostel_id !== where.room.hostel_id) return false;
      if (where.OR) {
        const monthStart: Date = where.OR[1].end_date.gte;
        if (!(a.end_date === null || a.end_date >= monthStart)) return false;
      }
      return true;
    });
  },
};

(prisma as any).rentObligation = {
  findMany: async ({ where }: any) => {
    return state.obligations.filter(o => {
      if (where.owner_id && o.owner_id !== where.owner_id) return false;
      if (where.obligation_type && o.obligation_type !== where.obligation_type) return false;
      if (where.rent_month && !sameDate(o.rent_month, where.rent_month)) return false;
      return true;
    });
  },
};

(prisma as any).hostel = {
  findMany: async ({ where }: any) => {
    return state.hostels.filter(h => {
      if (where.owner_id && h.owner_id !== where.owner_id) return false;
      if (where.is_active !== undefined && h.is_active !== where.is_active) return false;
      return true;
    });
  },
};

(eventLog as any).log = async (...args: any[]) => {
  state.eventLogs.push(args);
};

import { RentReconciliationService } from "./rent-reconciliation-service";
const recon = new RentReconciliationService();

// ── Helpers ───────────────────────────────────────────────────────────────────

let alloc_seq = 0;
let oblig_seq = 0;

function makeAlloc(ownerId: string, hostelId: string, rent = 5000, maint = 0): Allocation {
  const id = `alloc-${++alloc_seq}`;
  return {
    id,
    is_active: true,
    start_date: new Date("2026-01-01T00:00:00Z"),
    end_date: null,
    tenant: { id: `t-${id}`, owner_id: ownerId, status: "ACTIVE", monthly_rent: rent, maintenance_charge: maint, maintenance_type: "MONTHLY" },
    room: { hostel_id: hostelId },
  };
}

function makeObligation(alloc: Allocation, type = "RENT"): Obligation {
  return {
    id: `o-${++oblig_seq}`,
    allocation_id: alloc.id,
    tenant_id: alloc.tenant.id,
    owner_id: alloc.tenant.owner_id,
    rent_month: RENT_MONTH,
    obligation_type: type,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testOkWhenAllObligationsPresent() {
  console.log("\n[P6] OK when all obligations present");
  resetState();
  const a1 = makeAlloc("o1", "h1");
  const a2 = makeAlloc("o1", "h1");
  state.allocations.push(a1, a2);
  state.obligations.push(makeObligation(a1), makeObligation(a2));

  const r = await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  assertEq(r.status, "OK", "status OK");
  assertEq(r.expected_count, 2, "expected 2");
  assertEq(r.actual_count, 2, "actual 2");
  assertEq(r.missing_count, 0, "no missing");
  assertEq(r.duplicate_count, 0, "no duplicates");
  assertEq(r.orphan_count, 0, "no orphans");
  assertEq(r.anomalies.length, 0, "no anomalies");
}

async function testMissingObligationDetected() {
  console.log("\n[P6] MISSING detected when obligation absent");
  resetState();
  const a1 = makeAlloc("o1", "h1");
  const a2 = makeAlloc("o1", "h1");
  state.allocations.push(a1, a2);
  state.obligations.push(makeObligation(a1)); // a2 has no obligation

  const r = await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  assertEq(r.status, "MISSING", "status MISSING");
  assertEq(r.missing_count, 1, "1 missing");
  assertEq(r.expected_count, 2, "expected 2");
  assertEq(r.actual_count, 1, "actual 1");
  assert(r.anomalies.some(a => a.type === "MISSING" && a.allocation_id === a2.id), "anomaly points to a2");
}

async function testDuplicateObligationDetected() {
  console.log("\n[P6] DUPLICATE detected when same allocation has 2 obligations");
  resetState();
  const a1 = makeAlloc("o1", "h1");
  state.allocations.push(a1);
  const o1 = makeObligation(a1);
  const o2 = { ...makeObligation(a1), id: `o-${++oblig_seq}` };
  state.obligations.push(o1, o2);

  const r = await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  assertEq(r.status, "DUPLICATE", "status DUPLICATE");
  assertEq(r.duplicate_count, 1, "1 duplicate");
  assert(r.anomalies.some(a => a.type === "DUPLICATE" && a.obligation_count === 2), "2 obligations flagged");
}

async function testOrphanObligationDetected() {
  console.log("\n[P6] ORPHAN detected when obligation has no active allocation");
  resetState();
  // No allocations in state, but an obligation exists (orphan from a deleted/ended tenant)
  const fakeObligation: Obligation = {
    id: `o-${++oblig_seq}`,
    allocation_id: "ghost-alloc",
    tenant_id: "ghost-tenant",
    owner_id: "o1",
    rent_month: RENT_MONTH,
    obligation_type: "RENT",
  };
  state.obligations.push(fakeObligation);

  const r = await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  assertEq(r.status, "ORPHAN", "status ORPHAN");
  assertEq(r.orphan_count, 1, "1 orphan");
  assert(r.anomalies.some(a => a.type === "ORPHAN" && a.allocation_id === "ghost-alloc"), "orphan allocation flagged");
}

async function testZeroAllocationZeroObligationIsOk() {
  console.log("\n[P6] zero allocations + zero obligations = OK (no tenants this month)");
  resetState();
  const r = await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  assertEq(r.status, "OK", "status OK");
  assertEq(r.expected_count, 0, "expected 0");
  assertEq(r.actual_count, 0, "actual 0");
}

async function testMaintenanceReconcilesIndependently() {
  console.log("\n[P6] MAINTENANCE reconciliation independent of RENT");
  resetState();
  const a1 = makeAlloc("o1", "h1", 5000, 500); // has maintenance
  state.allocations.push(a1);
  state.obligations.push(makeObligation(a1, "RENT"));
  // No MAINTENANCE obligation — should be detected as MISSING

  const r = await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "MAINTENANCE");
  assertEq(r.status, "MISSING", "MAINTENANCE missing detected");
  assertEq(r.missing_count, 1, "1 maint missing");
}

async function testAllocWithZeroRentNotExpected() {
  console.log("\n[P6] allocation with zero rent is not in expected set");
  resetState();
  const a1 = makeAlloc("o1", "h1", 0); // zero rent — should not generate
  state.allocations.push(a1);
  // No obligation — but expected_count should be 0

  const r = await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  assertEq(r.status, "OK", "status OK — zero-rent not expected");
  assertEq(r.expected_count, 0, "expected 0 for zero-rent alloc");
}

async function testAnomalyEventEmittedOnFailure() {
  console.log("\n[P6] RECONCILIATION_FAILED event emitted on anomaly");
  resetState();
  const a1 = makeAlloc("o1", "h1");
  state.allocations.push(a1);
  // No obligation — MISSING

  await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  const reconEvent = state.eventLogs.find(e => e[0] === "RECONCILIATION_FAILED");
  assert(!!reconEvent, "RECONCILIATION_FAILED event emitted");
  assertEq(reconEvent[1], "o1", "event owner_id correct");
  assert(reconEvent[2]?.hostel_id === "h1", "event hostel_id correct");
  assert(reconEvent[2]?.missing_count === 1, "event missing_count correct");
}

async function testNoAnomalyEventWhenOk() {
  console.log("\n[P6] no RECONCILIATION_FAILED event when status is OK");
  resetState();
  const a1 = makeAlloc("o1", "h1");
  state.allocations.push(a1);
  state.obligations.push(makeObligation(a1));

  await recon.reconcileHostelMonth("h1", "o1", RENT_MONTH, "RENT");
  const reconEvent = state.eventLogs.find(e => e[0] === "RECONCILIATION_FAILED");
  assert(!reconEvent, "no RECONCILIATION_FAILED event for OK result");
}

async function testReconcileOwnerMonth() {
  console.log("\n[P6] reconcileOwnerMonth runs per-hostel");
  resetState();
  state.hostels.push({ id: "h1", owner_id: "o1", is_active: true });
  state.hostels.push({ id: "h2", owner_id: "o1", is_active: true });
  const a1 = makeAlloc("o1", "h1");
  const a2 = makeAlloc("o1", "h2");
  state.allocations.push(a1, a2);
  state.obligations.push(makeObligation(a1)); // h2 missing

  const summary = await recon.reconcileOwnerMonth("o1", RENT_MONTH);
  assertEq(summary.total_hostels, 2, "2 hostels");
  assert(summary.failed_count > 0, "at least one failed hostel");
  assert(summary.total_missing > 0, "total_missing > 0");
}

async function main() {
  await testOkWhenAllObligationsPresent();
  await testMissingObligationDetected();
  await testDuplicateObligationDetected();
  await testOrphanObligationDetected();
  await testZeroAllocationZeroObligationIsOk();
  await testMaintenanceReconcilesIndependently();
  await testAllocWithZeroRentNotExpected();
  await testAnomalyEventEmittedOnFailure();
  await testNoAnomalyEventWhenOk();
  await testReconcileOwnerMonth();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) { failures.forEach(f => console.log(f)); process.exit(1); }
}

main().catch(err => { console.error("Test runner crashed:", err); process.exit(1); });
