import { operationalPendingInvariantHolds } from "./financial-invariants";
import {
  assertFinancialHostelMatch,
  assertSameFinancialHostel,
  assertScopedEntityHostel,
  requireFinancialHostelId,
} from "./financial-isolation";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  OK: ${name}`);
    return;
  }
  failed++;
  console.error(`  FAIL: ${name}`);
}

function assertThrows(fn: () => void, code: string, name: string) {
  try {
    fn();
    failed++;
    console.error(`  FAIL: ${name}`);
  } catch (err: any) {
    if (String(err?.message || "").includes(code) || err?.code === code) {
      passed++;
      console.log(`  OK: ${name}`);
      return;
    }
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    Expected ${code}, got ${err?.message || err}`);
  }
}

console.log("\nRunning financial invariants tests\n");

assert(
  operationalPendingInvariantHolds(0, 0),
  "pending=0 allows unpaid_tenant_count=0",
);

assert(
  !operationalPendingInvariantHolds(0, 1),
  "pending=0 rejects unpaid_tenant_count>0",
);

assert(
  operationalPendingInvariantHolds(1500, 1),
  "pending>0 allows unpaid_tenant_count>0",
);

assert(
  operationalPendingInvariantHolds(1500, 0),
  "pending>0 does not force non-zero tenant count",
);

assert(
  requireFinancialHostelId("hostel-a", "test") === "hostel-a",
  "financial hostel context accepts explicit hostelId",
);

assertThrows(
  () => requireFinancialHostelId("", "test"),
  "HOSTEL_CONTEXT_REQUIRED",
  "financial hostel context rejects missing hostelId",
);

assert(
  (() => {
    assertFinancialHostelMatch("payment", "hostel-a", "hostel-a");
    return true;
  })(),
  "financial hostel match accepts same hostel",
);

assertThrows(
  () => assertFinancialHostelMatch("payment", "hostel-b", "hostel-a"),
  "HOSTEL_CONTEXT_MISMATCH",
  "financial hostel match rejects cross-hostel child",
);

assert(
  (() => {
    assertScopedEntityHostel("rent obligation", { id: "ob-1", hostel_id: "hostel-a" }, "hostel-a");
    assertSameFinancialHostel(
      "receipt",
      { id: "r-1", hostel_id: "hostel-a" },
      "payment",
      { id: "p-1", hostel_id: "hostel-a" },
    );
    return true;
  })(),
  "financial scoped entity assertions accept same-hostel lineage",
);

assertThrows(
  () => assertSameFinancialHostel(
    "receipt",
    { id: "r-1", hostel_id: "hostel-b" },
    "payment",
    { id: "p-1", hostel_id: "hostel-a" },
  ),
  "HOSTEL_CONTEXT_MISMATCH",
  "financial lineage rejects receipt/payment hostel mismatch",
);

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);

if (failed > 0) process.exit(1);
