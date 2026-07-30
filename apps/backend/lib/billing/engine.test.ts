/**
 * 🧪 Billing Engine Tests
 *
 * Run: npx tsx lib/billing/engine.test.ts
 *
 * Tests the shared billing calculation engine against
 * all documented edge cases.
 */

import { calculateLateFees, resolveRules, calculateSingleRuleFee, type BillingConfig, type LateFeeRule } from "./engine";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertEq(actual: number, expected: number, name: string) {
  assert(actual === expected, name, `expected ${expected}, got ${actual}`);
}

// ─── Test Configs ────────────────────────────────────────────────

const BASIC_FLAT: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_rules: [{ id: "r1", type: "flat", amount: 200, after_days: 5, enabled: true }],
  max_late_fee: 0,
};

const BASIC_PERCENTAGE: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_rules: [{ id: "r1", type: "percentage", value: 5, after_days: 5, enabled: true }],
  max_late_fee: 0,
};

const BASIC_PER_DAY: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_rules: [{ id: "r1", type: "per_day", amount: 50, after_days: 3, enabled: true }],
  max_late_fee: 0,
};

const WITH_GRACE: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 3,
  late_fee_rules: [{ id: "r1", type: "flat", amount: 200, after_days: 5, enabled: true }],
  max_late_fee: 0,
};

const WITH_CAP: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_rules: [{ id: "r1", type: "per_day", amount: 100, after_days: 3, enabled: true }],
  max_late_fee: 500,
};

const MULTI_RULE: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_rules: [
    { id: "r1", type: "flat", amount: 100, after_days: 3, enabled: true },
    { id: "r2", type: "per_day", amount: 50, after_days: 5, enabled: true },
  ],
  max_late_fee: 500,
};

const NO_RULES: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_rules: [],
  max_late_fee: 0,
};

const DISABLED_RULE: BillingConfig = {
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_rules: [{ id: "r1", type: "flat", amount: 500, after_days: 1, enabled: false }],
  max_late_fee: 0,
};

// ─── Test Suite ──────────────────────────────────────────────────

console.log("\n🧪 Billing Engine Tests\n");

// ── 1. Zero Delay ──
console.log("── Case 1: Zero Delay");
{
  const r = calculateLateFees(BASIC_FLAT, 8000, 0);
  assertEq(r.totalLateFee, 0, "No fee at 0 delay");
  assertEq(r.totalPayable, 8000, "Total = rent only");
  assertEq(r.breakdown.length, 0, "No breakdown items");
}

// ── 2. Delay Before Rule Trigger ──
console.log("── Case 2: Delay Before Rule Trigger");
{
  const r = calculateLateFees(BASIC_FLAT, 8000, 3);
  assertEq(r.totalLateFee, 0, "No fee before after_days");
  assertEq(r.totalPayable, 8000, "Total unchanged");
}

// ── 3. Flat Fee Triggers ──
console.log("── Case 3: Flat Fee at Trigger Day");
{
  const r = calculateLateFees(BASIC_FLAT, 8000, 5);
  assertEq(r.totalLateFee, 200, "Flat ₹200 applied");
  assertEq(r.totalPayable, 8200, "Total correct");
  assertEq(r.breakdown.length, 1, "One breakdown item");
}

// ── 4. Flat Fee Stays Same After Trigger ──
console.log("── Case 4: Flat Fee Stays Same After Trigger");
{
  const r = calculateLateFees(BASIC_FLAT, 8000, 15);
  assertEq(r.totalLateFee, 200, "Flat fee doesn't increase with time");
  assertEq(r.totalPayable, 8200, "Total still 8200");
}

// ── 5. Percentage Fee ──
console.log("── Case 5: Percentage Fee");
{
  const r = calculateLateFees(BASIC_PERCENTAGE, 8000, 5);
  assertEq(r.totalLateFee, 400, "5% of 8000 = 400");
  assertEq(r.totalPayable, 8400, "Total correct");
}

// ── 6. Percentage on Different Rent ──
console.log("── Case 6: Percentage Scales with Rent");
{
  const r = calculateLateFees(BASIC_PERCENTAGE, 12000, 5);
  assertEq(r.totalLateFee, 600, "5% of 12000 = 600");
}

// ── 7. Per-Day Fee (correct math) ──
console.log("── Case 7: Per-Day Fee");
{
  // Delay 10, after_days 3 → active days = 10 - 3 = 7
  const r = calculateLateFees(BASIC_PER_DAY, 8000, 10);
  assertEq(r.totalLateFee, 350, "₹50/day × 7 days = ₹350");
  assertEq(r.totalPayable, 8350, "Total correct");
}

// ── 8. Per-Day at Exact Trigger Day ──
console.log("── Case 8: Per-Day at Exact Trigger");
{
  // Delay 3, after_days 3 → active days = 3 - 3 = 0
  const r = calculateLateFees(BASIC_PER_DAY, 8000, 3);
  assertEq(r.totalLateFee, 0, "0 active days = no fee");
}

// ── 9. Per-Day One Day After Trigger ──
console.log("── Case 9: Per-Day One Day After Trigger");
{
  // Delay 4, after_days 3 → active days = 4 - 3 = 1
  const r = calculateLateFees(BASIC_PER_DAY, 8000, 4);
  assertEq(r.totalLateFee, 50, "₹50/day × 1 day = ₹50");
}

// ── 10. Grace Period Absorbs Delay ──
console.log("── Case 10: Grace Period");
{
  // grace=3, after_days=5, delay=7 → effective=4, 4 < 5 → no fee
  const r = calculateLateFees(WITH_GRACE, 8000, 7);
  assertEq(r.totalLateFee, 0, "Grace absorbs delay (7 - 3 = 4 < 5)");
  assertEq(r.effectiveDelay, 4, "Effective delay correct");
  assertEq(r.graceDaysApplied, 3, "Grace days recorded");
}

// ── 11. Grace Period + Trigger ──
console.log("── Case 11: Grace Period + Rule Triggers");
{
  // grace=3, after_days=5, delay=9 → effective=6, 6 >= 5 → fee
  const r = calculateLateFees(WITH_GRACE, 8000, 9);
  assertEq(r.totalLateFee, 200, "Fee applies after grace+after_days");
  assertEq(r.effectiveDelay, 6, "Effective delay correct");
}

// ── 12. Grace Period Full Absorption ──
console.log("── Case 12: Within Grace Period");
{
  // grace=3, delay=2 → effective=0 → no fee
  const r = calculateLateFees(WITH_GRACE, 8000, 2);
  assertEq(r.totalLateFee, 0, "Within grace, no fee");
  assertEq(r.effectiveDelay, 0, "Effective delay = 0");
}

// ── 13. Max Cap Enforced ──
console.log("── Case 13: Max Cap");
{
  // per_day ₹100, after 3d, cap ₹500, delay=20 → active=17 → ₹1700 → capped at ₹500
  const r = calculateLateFees(WITH_CAP, 8000, 20);
  assertEq(r.totalLateFee, 500, "Capped at ₹500");
  assertEq(r.totalPayable, 8500, "Total respects cap");
  assert(r.capApplied === true, "capApplied flag set");
}

// ── 14. Cap Just Under ──
console.log("── Case 14: Cap Just Under");
{
  // per_day ₹100, after 3d, cap ₹500, delay=8 → active=5 → ₹500 = exactly at cap
  const r = calculateLateFees(WITH_CAP, 8000, 8);
  assertEq(r.totalLateFee, 500, "Exactly at cap");
  assert(r.capApplied === true, "capApplied at boundary");
}

// ── 15. Multiple Rules Cumulative ──
console.log("── Case 15: Multiple Rules Cumulative");
{
  // r1: flat ₹100 after 3d, r2: per_day ₹50 after 5d, cap ₹500
  // delay=10 → r1: ₹100, r2: ₹50*(10-5)=₹250 → total=₹350
  const r = calculateLateFees(MULTI_RULE, 8000, 10);
  assertEq(r.totalLateFee, 350, "Both rules cumulative: ₹100 + ₹250");
  assertEq(r.breakdown.length, 2, "Two breakdown items");
  assertEq(r.totalPayable, 8350, "Total correct");
}

// ── 16. Multiple Rules + Cap ──
console.log("── Case 16: Multiple Rules + Cap Hit");
{
  // delay=20 → r1: ₹100, r2: ₹50*(20-5)=₹750 → total would be ₹850 → capped at ₹500
  // r1 applies first: ₹100, then r2: ₹400 (capped from ₹750)
  const r = calculateLateFees(MULTI_RULE, 8000, 20);
  assertEq(r.totalLateFee, 500, "Multi-rule capped at ₹500");
  assert(r.capApplied === true, "Cap flag set");
}

// ── 17. No Rules = No Fee ──
console.log("── Case 17: No Rules");
{
  const r = calculateLateFees(NO_RULES, 8000, 30);
  assertEq(r.totalLateFee, 0, "No rules = no fee");
}

// ── 18. Disabled Rule Ignored ──
console.log("── Case 18: Disabled Rule Ignored");
{
  const r = calculateLateFees(DISABLED_RULE, 8000, 30);
  assertEq(r.totalLateFee, 0, "Disabled rule ignored");
}

// ── 19. Partial Payment (remaining as base) ──
console.log("── Case 19: Partial Payment Scenario");
{
  // Tenant paid 4000, remaining 4000. Percentage fee on REMAINING
  const r = calculateLateFees(BASIC_PERCENTAGE, 4000, 5);
  assertEq(r.totalLateFee, 200, "5% of remaining ₹4000 = ₹200");
  assertEq(r.totalPayable, 4200, "Total on remaining correct");
}

// ── 20. Negative / Zero Edge Cases ──
console.log("── Case 20: Edge Cases");
{
  const r1 = calculateLateFees(BASIC_FLAT, 0, 10);
  assertEq(r1.totalLateFee, 200, "Flat fee applies even on zero rent");

  const r2 = calculateLateFees(BASIC_FLAT, 8000, -5);
  assertEq(r2.totalLateFee, 0, "Negative delay = no fee");

  const r3 = calculateLateFees(BASIC_PERCENTAGE, 0, 10);
  assertEq(r3.totalLateFee, 0, "Percentage of ₹0 = ₹0");
}

// ── 21. resolveRules Legacy Migration ──
console.log("── Case 21: Legacy Migration");
{
  const legacy = {
    late_fee_type: "flat",
    late_fee_amount: 300,
    late_fee_after_days: 7,
    grace_days: 2,
    max_late_fee: 1000,
  };
  const resolved = resolveRules(legacy);
  assertEq(resolved.rules.length, 1, "One rule from legacy");
  assertEq(resolved.rules[0].amount!, 300, "Amount migrated");
  assertEq(resolved.rules[0].after_days, 7, "After days migrated");
  assertEq(resolved.graceDays, 2, "Grace migrated");
  assertEq(resolved.maxCap, 1000, "Cap migrated");
}

// ── 22. resolveRules New Format ──
console.log("── Case 22: New Rules Format Preferred");
{
  const config = {
    late_fee_type: "flat",
    late_fee_amount: 999,
    late_fee_rules: [{ id: "new1", type: "per_day", amount: 50, after_days: 3, enabled: true }],
    grace_days: 1,
    max_late_fee: 500,
  };
  const resolved = resolveRules(config);
  assertEq(resolved.rules.length, 1, "New format takes precedence");
  assert(resolved.rules[0].type === "per_day", "Type from new rules");
}

// ── 23. resolveRules No Config ──
console.log("── Case 23: No Fee Config");
{
  const resolved = resolveRules({});
  assertEq(resolved.rules.length, 0, "Empty config = no rules");
  const resolved2 = resolveRules({ late_fee_type: "none" });
  assertEq(resolved2.rules.length, 0, "'none' type = no rules");
}

// ── 24. calculateSingleRuleFee ──
console.log("── Case 24: Single Rule Fee");
{
  const flat: LateFeeRule = { id: "t", type: "flat", amount: 200, after_days: 5, enabled: true };
  assertEq(calculateSingleRuleFee(flat, 8000), 200, "Flat single = ₹200");

  const pct: LateFeeRule = { id: "t", type: "percentage", value: 5, after_days: 5, enabled: true };
  assertEq(calculateSingleRuleFee(pct, 8000), 400, "Percentage single = ₹400");

  const daily: LateFeeRule = { id: "t", type: "per_day", amount: 50, after_days: 3, enabled: true };
  assertEq(calculateSingleRuleFee(daily, 8000), 50, "Per-day single = ₹50 (one day)");
}

// ── Summary ──
console.log(`\n${"─".repeat(50)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${"─".repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
