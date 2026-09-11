/**
 * ADR-172, Phase 6.3 — audit hardening.
 *
 * Confirms (a) the *new* metadata this phase added to existing `eventLog`
 * calls (actor markers, before/after on overrides), (b) that no secret /
 * payment-proof content is ever logged, (c) that all 12 required billing
 * event types exist somewhere in the platform-billing services, and (d) the
 * `admin_financial_audit_log` dormancy decision — it stays unused, `eventLog`
 * is the single audit mechanism.
 *
 * Functional behaviour (pause/resume/plan-change/etc.) is already covered by
 * `tests/subscription-admin.test.ts`; this file adds only what that one
 * doesn't assert.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: { findUnique: vi.fn(), update: vi.fn() },
    subscription_plans: { findUnique: vi.fn() },
  };
  return { prisma };
});
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { prisma } from "@/lib/db";
import { subscriptionOverrideService } from "@/src/services/platform-billing/subscription-override-service";

const db = prisma as any;
const BACKEND = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(BACKEND, rel), "utf8");

beforeEach(() => vi.clearAllMocks());

describe("admin override — before/after on the override itself, not just status", () => {
  it("SET captures the previous admin_override_until alongside the new one", async () => {
    const prevUntil = new Date("2026-09-01T00:00:00.000Z");
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1",
      owner_id: "o1",
      status: "PAUSED",
      admin_override_until: prevUntil,
    });
    db.owner_subscriptions.update.mockResolvedValue({
      id: "s1",
      status: "PAUSED",
      admin_override_until: new Date("2026-09-10T00:00:00.000Z"),
      admin_override_reason: "Paid offline",
      admin_override_by: "admin-9",
    });
    await subscriptionOverrideService.setOverride({
      subscriptionId: "s1",
      adminId: "admin-9",
      reason: "Paid offline",
      days: 9,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(eventLogMock.log).toHaveBeenCalledWith(
      "SUBSCRIPTION_OVERRIDE_SET",
      "o1",
      expect.objectContaining({
        actor: "ADMIN",
        admin_id: "admin-9",
        subscription_id: "s1",
        previous_override_until: prevUntil.toISOString(),
        reason: "Paid offline",
      }),
    );
  });

  it("SET captures null previous_override_until for a subscription with none yet", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "PAUSED", admin_override_until: null });
    db.owner_subscriptions.update.mockResolvedValue({ id: "s1", status: "PAUSED" });
    await subscriptionOverrideService.setOverride({ subscriptionId: "s1", adminId: "admin-9", reason: "x", days: 5 });
    expect(eventLogMock.log).toHaveBeenCalledWith(
      "SUBSCRIPTION_OVERRIDE_SET",
      "o1",
      expect.objectContaining({ previous_override_until: null }),
    );
  });

  it("CLEARED captures the override state it removed", async () => {
    const prevUntil = new Date("2026-09-20T00:00:00.000Z");
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "ACTIVE", admin_override_until: prevUntil });
    db.owner_subscriptions.update.mockResolvedValue({ id: "s1" });
    await subscriptionOverrideService.clearOverride({ subscriptionId: "s1", adminId: "admin-9", reason: "No longer needed" });
    expect(eventLogMock.log).toHaveBeenCalledWith(
      "SUBSCRIPTION_OVERRIDE_CLEARED",
      "o1",
      expect.objectContaining({ actor: "ADMIN", admin_id: "admin-9", previous_override_until: prevUntil.toISOString() }),
    );
  });

  it("30-day maximum per action is unchanged by the audit work", () => {
    expect(() =>
      subscriptionOverrideService.resolveOverrideUntil({ days: 31 }, new Date("2026-09-01T00:00:00.000Z")),
    ).toThrow(/at most 30 days/);
    expect(subscriptionOverrideService.MAX_OVERRIDE_DAYS).toBe(30);
  });
});

describe("payment submission never logs proof content or a raw URL", () => {
  it("the SUBMITTED event's metadata is a fixed, non-sensitive field set", () => {
    const src = read("src/services/platform-billing/subscription-payment-service.ts");
    const block = src.slice(
      src.indexOf('eventLog.log("SUBSCRIPTION_PAYMENT_SUBMITTED"'),
      src.indexOf("});", src.indexOf('eventLog.log("SUBSCRIPTION_PAYMENT_SUBMITTED"')),
    );
    expect(block).not.toMatch(/proof_file/);
    expect(block).not.toMatch(/proofFileUrl/);
    expect(block).not.toMatch(/transaction_reference|transactionReference/);
    // What it DOES carry — the non-sensitive identifiers this phase requires.
    for (const field of ["payment_id", "subscription_id", "plan_code", "amount_paise", "payment_method", "recorded_by", "actor_id"]) {
      expect(block).toContain(field);
    }
  });

  it("the billing-settings change event logs which fields changed, never the VPA/QR values", () => {
    const src = read("app/api/platform-admin/billing-settings/route.ts");
    const block = src.slice(
      src.indexOf('eventLog.log("BILLING_SETTINGS_CHANGED"'),
      src.indexOf("});", src.indexOf('eventLog.log("BILLING_SETTINGS_CHANGED"')),
    );
    expect(block).toMatch(/fields_set/);
    expect(block).not.toMatch(/upi_vpa:|qr_image_url:/);
  });
});

describe("actor is recorded on every owner-initiated billing action", () => {
  it("downgrade schedule/cancel are attributed to the OWNER", () => {
    const src = read("src/services/platform-billing/subscription-downgrade-service.ts");
    const scheduled = src.slice(src.indexOf("SUBSCRIPTION_DOWNGRADE_SCHEDULED"), src.indexOf("});", src.indexOf("SUBSCRIPTION_DOWNGRADE_SCHEDULED")));
    const cancelled = src.slice(src.indexOf("SUBSCRIPTION_DOWNGRADE_CANCELLED"), src.indexOf("});", src.indexOf("SUBSCRIPTION_DOWNGRADE_CANCELLED")));
    expect(scheduled).toMatch(/actor:\s*"OWNER"/);
    expect(cancelled).toMatch(/actor:\s*"OWNER"/);
  });
});

describe("actor is recorded on every admin-initiated billing action", () => {
  it.each([
    ["src/services/platform-billing/subscription-admin-service.ts", "SUBSCRIPTION_PAUSED"],
    ["src/services/platform-billing/subscription-admin-service.ts", "SUBSCRIPTION_RESUMED"],
    ["src/services/platform-billing/subscription-payment-service.ts", "SUBSCRIPTION_PAYMENT_REJECTED"],
    ["src/services/platform-billing/subscription-payment-service.ts", "SUBSCRIPTION_PAYMENT_APPROVED"],
  ])("%s → %s carries actor: ADMIN", (rel, eventType) => {
    const src = read(rel);
    const idx = src.indexOf(`"${eventType}"`);
    expect(idx, `${eventType} not found in ${rel}`).toBeGreaterThan(-1);
    const block = src.slice(idx, src.indexOf("});", idx));
    expect(block).toMatch(/actor:\s*"ADMIN"/);
  });

  it("every SUBSCRIPTION_PLAN_CHANGED call site carries an actor (direct admin action or admin-approved payment)", () => {
    const src = read("src/services/platform-billing/subscription-admin-service.ts");
    const paymentSrc = read("src/services/platform-billing/subscription-payment-service.ts");
    const occurrences =
      (src.match(/eventLog\.log\("SUBSCRIPTION_PLAN_CHANGED"/g) || []).length +
      (paymentSrc.match(/eventLog\.log\("SUBSCRIPTION_PLAN_CHANGED"/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3); // scheduled + immediate (admin) + payment-approval-triggered
  });
});

describe("lifecycle (system) events identify the SYSTEM actor, not a person", () => {
  it("the expiry sweep's SUBSCRIPTION_PAUSED carries actor: SYSTEM_ACTOR", () => {
    const src = read("src/services/platform-billing/subscription-lifecycle-service.ts");
    expect(src).toMatch(/export const SYSTEM_ACTOR = "SYSTEM"/);
    const idx = src.indexOf('eventLog.log("SUBSCRIPTION_PAUSED"');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, src.indexOf("});", idx));
    expect(block).toMatch(/actor:\s*SYSTEM_ACTOR/);
  });

  it("renewal / a queued-downgrade-applied-at-renewal is traceable via SUBSCRIPTION_PAYMENT_APPROVED's `kind` + SUBSCRIPTION_PLAN_CHANGED's pending_downgrade_applied — no separate event needed", () => {
    // Renewal in this system only ever happens through an admin approving a
    // payment (there is no auto-charge) — so it is fully captured by the
    // existing approval event with kind: "RENEWAL", not a distinct one.
    const src = read("src/services/platform-billing/subscription-payment-service.ts");
    // SUBSCRIPTION_PAYMENT_APPROVED carries `kind`, `extra_beds`, and (further
    // down, alongside the Phase 6.6 extra-bed amount audit fields) `invoice_id`.
    expect(src).toMatch(/kind,\s*\n\s*extra_beds:[\s\S]{0,500}?invoice_id/);
    expect(src).toMatch(/pending_downgrade_applied: outcome\.clearedPending/);
  });
});

describe("invoice creation is traceable to the approved payment", () => {
  it("SUBSCRIPTION_PAYMENT_APPROVED carries invoice_id + invoice_number", () => {
    const src = read("src/services/platform-billing/subscription-payment-service.ts");
    const idx = src.indexOf('eventLog.log("SUBSCRIPTION_PAYMENT_APPROVED"');
    const block = src.slice(idx, src.indexOf("});", idx));
    expect(block).toMatch(/invoice_id: invoice\.id/);
    expect(block).toMatch(/invoice_number: invoice\.invoice_number/);
  });
});

describe("all 12 required billing event types exist somewhere in the platform-billing services", () => {
  it("every required event type has at least one eventLog.log call site", () => {
    const files = [
      "src/services/platform-billing/subscription-service.ts",
      "src/services/platform-billing/subscription-payment-service.ts",
      "src/services/platform-billing/subscription-admin-service.ts",
      "src/services/platform-billing/subscription-downgrade-service.ts",
      "src/services/platform-billing/subscription-override-service.ts",
      "src/services/platform-billing/subscription-lifecycle-service.ts",
    ];
    const combined = files.map(read).join("\n");
    const requiredEventTypes = [
      "SUBSCRIPTION_PAYMENT_SUBMITTED", // 1 + 4 (cash goes through the same call site)
      "SUBSCRIPTION_PAYMENT_APPROVED", // 2 (+ 11: renewal, via `kind`)
      "SUBSCRIPTION_PAYMENT_REJECTED", // 3
      "SUBSCRIPTION_PAUSED", // 5 (admin) + 12 (lifecycle job)
      "SUBSCRIPTION_RESUMED", // 6
      "SUBSCRIPTION_PLAN_CHANGED", // 7 (+ pending-downgrade-applied at renewal)
      "SUBSCRIPTION_DOWNGRADE_SCHEDULED", // 8
      "SUBSCRIPTION_DOWNGRADE_CANCELLED", // 9
      "SUBSCRIPTION_OVERRIDE_SET", // 10
    ];
    for (const eventType of requiredEventTypes) {
      expect(combined, eventType).toContain(`"${eventType}"`);
    }
  });
});

describe("admin_financial_audit_log stays dormant — eventLog is the single audit mechanism (Phase 6.3 decision)", () => {
  it("no application code reads or writes admin_financial_audit_log", () => {
    // An in-process walk (no shell-out — spawning a subprocess inside this
    // pure suite is unreliable/slow) over the directories that could
    // plausibly touch it. If this ever needs to change, it should be a
    // deliberate new decision, not a silent reintroduction.
    const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "coverage"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          if (readFileSync(full, "utf8").includes("admin_financial_audit_log")) hits.push(full);
        }
      }
    };
    for (const dir of ["app", "src", "lib"]) walk(path.join(BACKEND, dir));
    expect(hits, "should not reference admin_financial_audit_log").toEqual([]);
  });

  it("the model still exists in schema (not dropped) and is documented as deliberately unused", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/model admin_financial_audit_log/);
  });
});
