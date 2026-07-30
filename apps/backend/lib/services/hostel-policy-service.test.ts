/**
 * Hostel policy resolver regression matrix.
 * Run: node ./node_modules/.bin/tsx lib/services/hostel-policy-service.test.ts
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail = "") {
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

async function main() {
  process.env.SUPABASE_URL ||= "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";
  const {
    normalizeHostelPolicy,
    compatibilityPreferencesToPolicyPatch,
    toCompatibilityPreferences,
    validateHostelPolicyForWrite,
  } = await import("./hostel-policy-service");

  console.log("\nHostel policy resolver matrix");

  const hostelA = {
    id: "hostel-a",
    owner_id: "owner-a",
    name: "Same Name PG",
    currency: "INR",
    rent_cycle: "MONTHLY",
    receipt_prefix: "A",
    timezone: "Asia/Kolkata",
    auto_rent_day: 1,
    upi_id: "a@upi",
    phonepe_merchant_id: null,
    gst_number: "GST-A",
    logo_url: "https://cdn/a.png",
    preferences_config: {
      due_day: 5,
      billing_defaults: { advance_deposit: 5000, maintenance_charge: 1000, maintenance_type: "MONTHLY" },
      reminder_day_1: true,
      reminder_day_5: true,
      reminder_day_10: false,
      require_profile_photo_onboarding: true,
    },
  };

  const hostelB = {
    ...hostelA,
    id: "hostel-b",
    owner_id: "owner-a",
    receipt_prefix: "B",
    upi_id: "b@upi",
    preferences_config: {
      billing: {
        due_day: 9,
        deposit: { default_amount: 15000 },
        maintenance: { amount: 2500, type: "ONE_TIME" },
      },
      reminders: { schedule: { after_due_days: [2, 6] } },
      tenant_rules: { profile_photo_required: false },
    },
  };

  const policyA = normalizeHostelPolicy(hostelA);
  const policyB = normalizeHostelPolicy(hostelB);

  assertEq(policyA.billing.deposit.default_amount, 5000, "Legacy billing defaults normalize into billing.deposit");
  assertEq(policyB.billing.deposit.default_amount, 15000, "Nested Hostel B policy remains isolated from Hostel A");
  assertEq(policyA.reminders.schedule.after_due_days.includes(10), false, "Legacy reminder booleans normalize deterministically");
  assertEq(policyB.reminders.schedule.after_due_days[0], 2, "Nested reminder schedule takes precedence");
  assertEq(policyA.tenant_rules.profile_photo_required, true, "Legacy tenant rule maps into tenant_rules domain");
  assertEq(policyB.payments.upi_id, "b@upi", "Typed hostel payment column merges into payments domain");

  const policyC = normalizeHostelPolicy({
    preferences_config: {
      reminder_before_due_days: [3, 1],
      reminder_after_due_days: [2, 4, 8],
      reminder_auto_stop_after_payment: false,
      reminder_escalation_tone: "FIRM",
    },
  });
  assertEq(policyC.reminders.schedule.before_due_days.join(","), "3,1", "Flat before-due schedule normalizes during transition");
  assertEq(policyC.reminders.schedule.after_due_days.join(","), "2,4,8", "Flat after-due schedule normalizes during transition");
  assertEq(policyC.reminders.auto_stop_after_payment, false, "Flat auto-stop setting maps into reminders domain");
  assertEq(policyC.reminders.escalation.tone, "FIRM", "Flat escalation tone maps into reminders domain");

  const compat = toCompatibilityPreferences(policyB);
  assertEq(compat.billing_defaults.advance_deposit, 15000, "Compatibility response preserves billing_defaults shape");
  assertEq(compat.upi_id, "b@upi", "Compatibility response preserves payment keys");

  const patch = compatibilityPreferencesToPolicyPatch({
    due_day: 12,
    billing_defaults: { advance_deposit: 7000, maintenance_charge: 0, maintenance_type: "NONE", auto_fill_room_rent: true, allow_override: true },
    require_profile_photo_onboarding: true,
    reminder_after_due_days: [1, 3, 7],
    reminder_before_due_days: [2],
    reminder_auto_stop_after_payment: false,
    reminder_escalation_tone: "POLITE",
  });
  assertEq(patch.billing.due_day, 12, "Flat due_day patch maps to billing domain");
  assertEq(patch.billing.maintenance.type, "NONE", "Flat billing default patch maps maintenance domain");
  assertEq(patch.tenant_rules.profile_photo_required, true, "Flat profile-photo patch maps tenant_rules domain");
  assertEq(patch.reminders.schedule.after_due_days.join(","), "1,3,7", "Flat custom reminder schedule patch maps to reminders domain");
  assertEq(patch.reminders.schedule.before_due_days.join(","), "2", "Flat before-due schedule patch maps to reminders domain");
  assertEq(patch.reminders.auto_stop_after_payment, false, "Flat auto-stop patch maps to reminders domain");
  assertEq(patch.reminders.escalation.tone, "POLITE", "Flat escalation tone patch maps to reminders domain");

  // Assertions for deposit calculation mode and months
  assertEq(policyA.billing.deposit.calculation_mode, "FLAT", "Legacy policy A defaults to FLAT calculation mode");
  assertEq(policyA.billing.deposit.deposit_months, 1, "Legacy policy A defaults to 1 deposit month");

  const policyWithCustomDeposit = normalizeHostelPolicy({
    preferences_config: {
      billing: {
        deposit: {
          calculation_mode: "MONTHS_OF_RENT",
          deposit_months: 3,
        }
      }
    }
  });
  assertEq(policyWithCustomDeposit.billing.deposit.calculation_mode, "MONTHS_OF_RENT", "calculation_mode normalizes correctly");
  assertEq(policyWithCustomDeposit.billing.deposit.deposit_months, 3, "deposit_months normalizes correctly");

  const compatWithDeposit = toCompatibilityPreferences(policyWithCustomDeposit);
  assertEq(compatWithDeposit.billing_defaults.deposit_calculation_mode, "MONTHS_OF_RENT", "toCompatibilityPreferences preserves calculation_mode");
  assertEq(compatWithDeposit.billing_defaults.deposit_months, 3, "toCompatibilityPreferences preserves deposit_months");

  const patchWithDeposit = compatibilityPreferencesToPolicyPatch({
    billing_defaults: {
      deposit_calculation_mode: "MONTHS_OF_RENT",
      deposit_months: 2,
    }
  });
  assertEq(patchWithDeposit.billing.deposit.calculation_mode, "MONTHS_OF_RENT", "compatibilityPreferencesToPolicyPatch maps calculation_mode");
  assertEq(patchWithDeposit.billing.deposit.deposit_months, 2, "compatibilityPreferencesToPolicyPatch maps deposit_months");

  try {
    validateHostelPolicyForWrite(normalizeHostelPolicy({ preferences_config: { billing: { deposit: { deposit_months: 13 } } } }));
    assert(false, "Invalid deposit_months (13) rejected");
  } catch {
    assert(true, "Invalid deposit_months (13) rejected");
  }

  try {
    validateHostelPolicyForWrite(normalizeHostelPolicy({ preferences_config: { billing: { deposit: { deposit_months: 0 } } } }));
    assert(false, "Invalid deposit_months (0) rejected");
  } catch {
    assert(true, "Invalid deposit_months (0) rejected");
  }

  try {
    validateHostelPolicyForWrite(normalizeHostelPolicy({ preferences_config: { billing: { deposit: { calculation_mode: "INVALID" as any } } } }));
    assert(false, "Invalid calculation_mode rejected");
  } catch {
    assert(true, "Invalid calculation_mode rejected");
  }

  try {
    validateHostelPolicyForWrite(normalizeHostelPolicy({ preferences_config: { billing: { due_day: 40 } } }));
    assert(false, "Invalid billing policy rejected");
  } catch {
    assert(true, "Invalid billing policy rejected");
  }

  console.log(`\nHostel policy resolver: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
