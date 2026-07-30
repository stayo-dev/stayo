/**
 * Event bus owner isolation regression.
 * Run: node ./node_modules/.bin/tsx lib/events/event-bus.test.ts
 */

import { addClient, broadcast, removeClient } from "./event-bus";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail = "") {
  if (condition) {
    console.log(`  OK ${name}`);
    passed++;
    return;
  }
  console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  failed++;
}

async function main() {
  console.log("\nEvent bus owner isolation");
  const ownerAEvents: any[] = [];
  const ownerBEvents: any[] = [];
  const portfolioEvents: any[] = [];

  const ownerA = { ownerId: "owner-a", hostelId: "hostel-a", scope: "hostel" as const, send: (data: any) => ownerAEvents.push(data) };
  const ownerB = { ownerId: "owner-b", hostelId: "hostel-b", scope: "hostel" as const, send: (data: any) => ownerBEvents.push(data) };
  const portfolio = { ownerId: "owner-a", scope: "portfolio" as const, send: (data: any) => portfolioEvents.push(data) };

  addClient(ownerA);
  addClient(ownerB);
  addClient(portfolio);

  try {
    broadcast("owner-a", { scope: "hostel", hostelId: "hostel-a", type: "PAYMENT_RECORDED" });
    assert(ownerAEvents.length === 1, "matching hostel receives event");
    assert(ownerBEvents.length === 0, "other owner does not receive event");
    assert(portfolioEvents.length === 0, "portfolio client does not receive hostel event");
  } finally {
    removeClient(ownerA);
    removeClient(ownerB);
    removeClient(portfolio);
  }

  console.log(`\nEvent bus isolation: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
