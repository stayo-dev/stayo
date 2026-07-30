/**
 * Collection strategy regression matrix.
 * Run: node ./node_modules/.bin/tsx lib/services/collection-strategy-service.test.ts
 */

import { resolveCollectionStrategy, selectReminderForOverdueDay } from "./collection-strategy-service";

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
  console.log("\nCollection strategy matrix");

  const custom = resolveCollectionStrategy({ reminder_after_due_days: [7, 1, 3, 3] });
  assertEq(custom.after_due_days.join(","), "1,3,7", "Custom schedule is unique and sorted");

  assertEq(selectReminderForOverdueDay(1, null, { reminder_after_due_days: [1, 3, 7] }), "DUE_SOON", "First configured day sends gentle reminder");
  assertEq(selectReminderForOverdueDay(3, null, { reminder_after_due_days: [1, 3, 7] }), "WARNING", "Middle configured day sends warning");
  assertEq(selectReminderForOverdueDay(7, null, { reminder_after_due_days: [1, 3, 7] }), "FINAL_NOTICE", "Final configured day sends final notice");
  assertEq(selectReminderForOverdueDay(5, null, { reminder_after_due_days: [2, 6] }), null, "Unconfigured day does not send");
  assertEq(selectReminderForOverdueDay(2, "DUE_SOON", { reminder_after_due_days: [2, 6] }), null, "Duplicate reminder type is skipped");
  assertEq(selectReminderForOverdueDay(6, "FINAL_NOTICE", { reminder_after_due_days: [2, 6, 9] }), null, "Final notice stops later strategy reminders");

  const legacy = resolveCollectionStrategy({ reminder_day_1: true, reminder_day_5: false, reminder_day_10: true });
  assertEq(legacy.after_due_days.join(","), "1,10", "Legacy booleans still normalize safely");

  assertEq(selectReminderForOverdueDay(1, null, { auto_send_reminders: false, reminder_after_due_days: [1] }), null, "Disabled strategy sends no reminder");

  console.log(`\nCollection strategy: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
