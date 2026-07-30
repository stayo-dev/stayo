/**
 * Phase 4 — Billing Validation Unit Tests
 *
 * Run:
 *   DOTENV_CONFIG_PATH=../../.env node -r dotenv/config ./node_modules/.bin/tsx lib/services/billing-validation.test.ts
 *
 * Pure functions — no DB, no mocks.
 */

import {
  validateBillingPreferences,
  computeDueDate,
  isValidTimezone,
  type PreferencesToValidate,
} from "./billing-validation";

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

const base: PreferencesToValidate = {
  hostel_id: "h1",
  owner_id: "o1",
  auto_rent_day: 1,
  due_day: 5,
  timezone: "Asia/Kolkata",
  rent_cycle: "MONTHLY",
};

// ── isValidTimezone ───────────────────────────────────────────────────────────
console.log("\nisValidTimezone");
assert(isValidTimezone("Asia/Kolkata"), "Asia/Kolkata is valid");
assert(isValidTimezone("UTC"), "UTC is valid");
assert(isValidTimezone("America/New_York"), "America/New_York is valid");
assert(!isValidTimezone("NotATimezone"), "NotATimezone is invalid");
assert(!isValidTimezone(""), "empty string is invalid");

// ── validateBillingPreferences — happy path ───────────────────────────────────
console.log("\nvalid config returns valid=true");
{
  const r = validateBillingPreferences(base);
  assert(r.valid, "valid config passes");
  assertEq(r.errors.length, 0, "no errors for valid config");
}

// ── auto_rent_day bounds ──────────────────────────────────────────────────────
console.log("\nauto_rent_day validation");
{
  const r = validateBillingPreferences({ ...base, auto_rent_day: 0 });
  assert(!r.valid, "day=0 is invalid");
  assert(r.errors.some(e => e.code === "INVALID_AUTO_RENT_DAY"), "INVALID_AUTO_RENT_DAY code");
}
{
  const r = validateBillingPreferences({ ...base, auto_rent_day: 29 });
  assert(!r.valid, "day=29 is invalid");
  assert(r.errors.some(e => e.code === "INVALID_AUTO_RENT_DAY"), "INVALID_AUTO_RENT_DAY for 29");
}
{
  const r = validateBillingPreferences({ ...base, auto_rent_day: 28 });
  assert(r.valid, "day=28 is valid (max)");
}
{
  const r = validateBillingPreferences({ ...base, auto_rent_day: 1 });
  assert(r.valid, "day=1 is valid (min)");
}

// ── due_day bounds ────────────────────────────────────────────────────────────
console.log("\ndue_day validation");
{
  const r = validateBillingPreferences({ ...base, due_day: 0 });
  assert(!r.valid, "due_day=0 is invalid");
  assert(r.errors.some(e => e.code === "INVALID_DUE_DAY"), "INVALID_DUE_DAY code");
}
{
  const r = validateBillingPreferences({ ...base, due_day: 29 });
  assert(!r.valid, "due_day=29 is invalid");
}

// ── timezone validation ───────────────────────────────────────────────────────
console.log("\ntimezone validation");
{
  const r = validateBillingPreferences({ ...base, timezone: "Fake/Zone" });
  assert(!r.valid, "invalid timezone fails");
  assert(r.errors.some(e => e.code === "INVALID_TIMEZONE"), "INVALID_TIMEZONE code");
}
{
  const r = validateBillingPreferences({ ...base, timezone: "America/New_York" });
  assert(r.valid, "valid timezone passes");
}

// ── rent_cycle ────────────────────────────────────────────────────────────────
console.log("\nrent_cycle validation");
{
  const r = validateBillingPreferences({ ...base, rent_cycle: "WEEKLY" });
  assert(!r.valid, "WEEKLY is unsupported");
  assert(r.errors.some(e => e.code === "UNSUPPORTED_RENT_CYCLE"), "UNSUPPORTED_RENT_CYCLE code");
}
{
  const r = validateBillingPreferences({ ...base, rent_cycle: "MONTHLY" });
  assert(r.valid, "MONTHLY is valid");
}

// ── due_day < auto_rent_day → WARNING (shift), not ERROR ─────────────────────
console.log("\ndue_day < auto_rent_day emits WARNING not ERROR");
{
  const r = validateBillingPreferences({ ...base, auto_rent_day: 10, due_day: 3 });
  assert(r.valid, "due_day<auto_rent_day is valid=true (warning only)");
  const warn = r.errors.find(e => e.code === "DUE_DAY_BEFORE_RENT_DAY_SHIFTED");
  assert(!!warn, "DUE_DAY_BEFORE_RENT_DAY_SHIFTED warning emitted");
  assertEq(warn?.severity, "WARNING", "severity is WARNING");
  assert(!!warn?.correction?.due_date_shifted_to_next_month, "correction flag set");
}

// ── structured error shape ────────────────────────────────────────────────────
console.log("\nvalidation errors carry hostel_id and owner_id");
{
  const r = validateBillingPreferences({ ...base, auto_rent_day: 0 });
  const err = r.errors[0];
  assertEq(err.hostel_id, "h1", "hostel_id on error");
  assertEq(err.owner_id, "o1", "owner_id on error");
  assertEq(err.severity, "ERROR", "severity ERROR");
}

// ── computeDueDate ────────────────────────────────────────────────────────────
console.log("\ncomputeDueDate");
{
  // Normal: due_day >= auto_rent_day → same month
  const d = computeDueDate(new Date("2026-05-01T00:00:00Z"), 1, 5);
  assertEq(d.toISOString(), "2026-05-05T00:00:00.000Z", "normal case same month");
}
{
  // Same day: due_day === auto_rent_day → same month
  const d = computeDueDate(new Date("2026-05-01T00:00:00Z"), 5, 5);
  assertEq(d.toISOString(), "2026-05-05T00:00:00.000Z", "due=rent day same month");
}
{
  // Shift: due_day < auto_rent_day → next month
  const d = computeDueDate(new Date("2026-05-01T00:00:00Z"), 10, 3);
  assertEq(d.toISOString(), "2026-06-03T00:00:00.000Z", "shifted to next month");
}
{
  // December edge: shift crosses year boundary
  const d = computeDueDate(new Date("2026-12-01T00:00:00Z"), 10, 3);
  assertEq(d.toISOString(), "2027-01-03T00:00:00.000Z", "Dec→Jan year boundary shift");
}

// ── Results ───────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach(f => console.log(f));
  process.exit(1);
}
