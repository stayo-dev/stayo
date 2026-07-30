/**
 * Payment status event regression suite.
 *
 * Run:
 *   DOTENV_CONFIG_PATH=../../.env node -r dotenv/config ./node_modules/.bin/tsx \
 *     lib/services/payment-status-event-service.test.ts
 */

import { randomUUID } from "crypto";
import { PaymentStatusEventService } from "./payment-status-event-service";

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  OK ${name}`);
    passed += 1;
  } else {
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
    failed += 1;
  }
}

async function test_append_generates_event_id() {
  const service = new PaymentStatusEventService();
  const attemptId = randomUUID();
  let createData: any = null;

  const tx = {
    $queryRaw: async () => [{ next_sequence: 1 }],
    paymentAttemptStatusEvent: {
      create: async ({ data }: any) => {
        createData = data;
        return data;
      },
    },
  };

  const event = await service.append(tx, {
    attemptId,
    fromStatus: null,
    toStatus: "CREATED",
    source: "TEST",
    reason: "regression",
    operationalOwnerId: randomUUID(),
    financialOwnerId: randomUUID(),
    hostelId: randomUUID(),
  });

  assert(typeof event.id === "string", "status event: id present");
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id),
    "status event: id is uuid",
    event.id,
  );
  assert(createData.payment_attempt_id === attemptId, "status event: attempt id preserved");
  assert(createData.transition_sequence === 1, "status event: sequence preserved");
}

async function main() {
  console.log("Payment status event tests");
  await test_append_generates_event_id();

  console.log(`\npassed: ${passed}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
