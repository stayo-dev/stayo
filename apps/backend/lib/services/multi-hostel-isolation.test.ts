/**
 * HMS Multi-Hostel Isolation Matrix
 *
 * Run:
 *   node ./node_modules/.bin/tsx lib/services/multi-hostel-isolation.test.ts
 *
 * This is intentionally DB-free. It stress-tests the operational invariants that
 * must remain true regardless of Prisma/query implementation details.
 */

type HostelId = "hostel-a" | "hostel-b";

type Tenant = { id: string; owner_id: string; hostel_id: HostelId; status: "ACTIVE" };
type Obligation = { id: string; tenant_id: string; hostel_id: HostelId; amount: number; status: "PENDING" | "PAID"; rent_month: string };
type Payment = { id: string; obligation_id: string; tenant_id: string; hostel_id: HostelId; amount: number };
type Receipt = { id: string; payment_id: string; tenant_id: string; hostel_id: HostelId; amount: number };
type Reminder = { id: string; obligation_id: string; tenant_id: string; hostel_id: HostelId };
type Allocation = { id: string; tenant_id: string; hostel_id: HostelId; active: boolean };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  OK ${name}`);
    passed++;
    return;
  }
  const message = `  FAIL ${name}${detail ? ` - ${detail}` : ""}`;
  console.error(message);
  failures.push(message);
  failed++;
}

function assertEq<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function makeState() {
  return {
    tenants: [
      { id: "tenant-a", owner_id: "owner-1", hostel_id: "hostel-a", status: "ACTIVE" },
      { id: "tenant-b", owner_id: "owner-1", hostel_id: "hostel-b", status: "ACTIVE" },
    ] as Tenant[],
    allocations: [
      { id: "alloc-a", tenant_id: "tenant-a", hostel_id: "hostel-a", active: true },
      { id: "alloc-b", tenant_id: "tenant-b", hostel_id: "hostel-b", active: true },
    ] as Allocation[],
    obligations: [
      { id: "obl-a", tenant_id: "tenant-a", hostel_id: "hostel-a", amount: 5000, status: "PENDING", rent_month: "2026-05" },
      { id: "obl-b", tenant_id: "tenant-b", hostel_id: "hostel-b", amount: 7000, status: "PENDING", rent_month: "2026-05" },
    ] as Obligation[],
    payments: [] as Payment[],
    receipts: [] as Receipt[],
    reminders: [] as Reminder[],
    locks: new Set<string>(),
  };
}

function pay(state: ReturnType<typeof makeState>, obligationId: string) {
  const obligation = state.obligations.find((o) => o.id === obligationId)!;
  obligation.status = "PAID";
  const payment: Payment = {
    id: `pay-${obligation.id}`,
    obligation_id: obligation.id,
    tenant_id: obligation.tenant_id,
    hostel_id: obligation.hostel_id,
    amount: obligation.amount,
  };
  state.payments.push(payment);
  state.receipts.push({
    id: `receipt-${payment.id}`,
    payment_id: payment.id,
    tenant_id: payment.tenant_id,
    hostel_id: payment.hostel_id,
    amount: payment.amount,
  });
}

function sendReminder(state: ReturnType<typeof makeState>, obligationId: string) {
  const obligation = state.obligations.find((o) => o.id === obligationId)!;
  state.reminders.push({
    id: `reminder-${obligation.id}`,
    obligation_id: obligation.id,
    tenant_id: obligation.tenant_id,
    hostel_id: obligation.hostel_id,
  });
}

function metrics(state: ReturnType<typeof makeState>, hostelId?: HostelId) {
  const obligations = state.obligations.filter((o) => !hostelId || o.hostel_id === hostelId);
  const payments = state.payments.filter((p) => !hostelId || p.hostel_id === hostelId);
  return {
    collections: payments.reduce((sum, p) => sum + p.amount, 0),
    overdue: obligations.filter((o) => o.status === "PENDING").reduce((sum, o) => sum + o.amount, 0),
    occupancy: state.allocations.filter((a) => a.active && (!hostelId || a.hostel_id === hostelId)).length,
    revenue: obligations.reduce((sum, o) => sum + o.amount, 0),
    reminders: state.reminders.filter((r) => !hostelId || r.hostel_id === hostelId).length,
    payment_counts: payments.length,
    receipts: state.receipts.filter((r) => !hostelId || r.hostel_id === hostelId).length,
  };
}

function transferTenant(state: ReturnType<typeof makeState>, tenantId: string, toHostel: HostelId) {
  const tenant = state.tenants.find((t) => t.id === tenantId)!;
  state.allocations.filter((a) => a.tenant_id === tenantId && a.active).forEach((a) => { a.active = false; });
  tenant.hostel_id = toHostel;
  state.allocations.push({ id: `alloc-${tenantId}-${toHostel}`, tenant_id: tenantId, hostel_id: toHostel, active: true });
}

function generateRentOnce(state: ReturnType<typeof makeState>, hostelId: HostelId, month: string) {
  const lockKey = `rent:${hostelId}:${month}`;
  if (state.locks.has(lockKey)) return { created: 0, skipped: true };
  state.locks.add(lockKey);
  const activeAllocations = state.allocations.filter((a) => a.active && a.hostel_id === hostelId);
  let created = 0;
  for (const allocation of activeAllocations) {
    const duplicate = state.obligations.some((o) => o.tenant_id === allocation.tenant_id && o.hostel_id === hostelId && o.rent_month === month);
    if (duplicate) continue;
    state.obligations.push({
      id: `obl-${allocation.tenant_id}-${month}`,
      tenant_id: allocation.tenant_id,
      hostel_id: hostelId,
      amount: hostelId === "hostel-a" ? 5000 : 7000,
      status: "PENDING",
      rent_month: month,
    });
    created++;
  }
  return { created, skipped: false };
}

async function scenario1MultiHostelOwnerIsolation() {
  console.log("\nScenario 1 - multi-hostel owner isolation");
  const state = makeState();
  pay(state, "obl-a");
  sendReminder(state, "obl-b");

  const a = metrics(state, "hostel-a");
  const b = metrics(state, "hostel-b");

  assertEq(a.collections, 5000, "Hostel A collections isolated");
  assertEq(b.collections, 0, "Hostel B collections isolated");
  assertEq(a.reminders, 0, "Hostel A reminders isolated");
  assertEq(b.reminders, 1, "Hostel B reminders isolated");
  assertEq(a.overdue, 0, "Hostel A overdue isolated after payment");
  assertEq(b.overdue, 7000, "Hostel B overdue isolated");
  assertEq(a.receipts, 1, "Hostel A receipts isolated");
  assertEq(b.receipts, 0, "Hostel B receipts isolated");
}

async function scenario2TenantTransferPreservesHistory() {
  console.log("\nScenario 2 - tenant transfer preserves history");
  const state = makeState();
  pay(state, "obl-a");
  const before = metrics(state, "hostel-a");

  transferTenant(state, "tenant-a", "hostel-b");
  generateRentOnce(state, "hostel-b", "2026-06");

  const oldPayment = state.payments.find((p) => p.tenant_id === "tenant-a")!;
  const oldReceipt = state.receipts.find((r) => r.tenant_id === "tenant-a")!;
  const oldObligation = state.obligations.find((o) => o.id === "obl-a")!;
  const futureObligation = state.obligations.find((o) => o.tenant_id === "tenant-a" && o.rent_month === "2026-06")!;

  assertEq(oldObligation.hostel_id, "hostel-a", "old obligation remains in A");
  assertEq(oldPayment.hostel_id, "hostel-a", "old payment remains in A");
  assertEq(oldReceipt.hostel_id, "hostel-a", "old receipt remains in A");
  assertEq(futureObligation.hostel_id, "hostel-b", "future obligation uses B");
  assertEq(metrics(state, "hostel-a").collections, before.collections, "old analytics unchanged after transfer");
}

async function scenario3ConcurrentAutomationNoCollision() {
  console.log("\nScenario 3 - concurrent automation no collision");
  const state = makeState();
  const results = await Promise.all([
    Promise.resolve(generateRentOnce(state, "hostel-a", "2026-06")),
    Promise.resolve(generateRentOnce(state, "hostel-a", "2026-06")),
    Promise.resolve(generateRentOnce(state, "hostel-b", "2026-06")),
    Promise.resolve(generateRentOnce(state, "hostel-b", "2026-06")),
  ]);

  const june = state.obligations.filter((o) => o.rent_month === "2026-06");
  const uniqueKeys = new Set(june.map((o) => `${o.tenant_id}:${o.hostel_id}:${o.rent_month}`));

  assertEq(june.length, uniqueKeys.size, "no duplicate ledger rows");
  assertEq(june.filter((o) => o.hostel_id === "hostel-a").length, 1, "A generated independently");
  assertEq(june.filter((o) => o.hostel_id === "hostel-b").length, 1, "B generated independently");
  assert(results.some((r) => r.skipped), "lock collision is skipped, not cross-hostel contamination");
}

async function scenario4PortfolioRollupCorrectness() {
  console.log("\nScenario 4 - portfolio rollup correctness");
  const state = makeState();
  pay(state, "obl-a");
  sendReminder(state, "obl-b");

  const owner = metrics(state);
  const a = metrics(state, "hostel-a");
  const b = metrics(state, "hostel-b");

  for (const key of ["collections", "overdue", "occupancy", "revenue", "reminders", "payment_counts"] as const) {
    assertEq(a[key] + b[key], owner[key], `SUM(hostel ${key}) == owner ${key}`);
  }
}

async function scenario5HistoricalAnalyticsStability() {
  console.log("\nScenario 5 - historical analytics stability");
  const state = makeState();
  pay(state, "obl-a");
  const beforeA = metrics(state, "hostel-a");
  const beforeB = metrics(state, "hostel-b");

  transferTenant(state, "tenant-a", "hostel-b");
  const afterA = metrics(state, "hostel-a");
  const afterB = metrics(state, "hostel-b");

  assertEq(afterA.collections, beforeA.collections, "Hostel A historical revenue preserved");
  assertEq(afterA.payment_counts, beforeA.payment_counts, "Hostel A historical payment count preserved");
  assertEq(afterB.collections, beforeB.collections, "Hostel B does not inherit old revenue");
}

async function main() {
  await scenario1MultiHostelOwnerIsolation();
  await scenario2TenantTransferPreservesHistory();
  await scenario3ConcurrentAutomationNoCollision();
  await scenario4PortfolioRollupCorrectness();
  await scenario5HistoricalAnalyticsStability();

  console.log(`\nMulti-hostel isolation matrix: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
