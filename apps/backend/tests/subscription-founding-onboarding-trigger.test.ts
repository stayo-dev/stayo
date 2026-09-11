/**
 * Founding Partner classification must be triggered by the owner completing
 * onboarding (their first hostel), NOT by the owner happening to open the
 * Subscription page (business rules, 2026-09-12). This file has two halves:
 *
 *  1. Static source assertions — the two real hostel-creation entry points
 *     actually call `subscriptionService.ensureForOwner`, so the hook is
 *     wired into the app, not just theoretically available.
 *  2. A behavioural test proving classification is correct when
 *     `ensureForOwner` is invoked WITHOUT ever going through
 *     `subscriptionService.getForOwner` (the Subscription page's read
 *     model) — i.e. the mechanism does not depend on that page at all.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const BACKEND = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(BACKEND, rel), "utf8");

describe("Founding classification is wired to onboarding completion (source), not the Subscription page", () => {
  it("POST /api/owner/hostels calls subscriptionService.ensureForOwner after creating the hostel", () => {
    const src = read("app/api/owner/hostels/route.ts");
    expect(src).toMatch(/subscriptionService\s*\.\s*ensureForOwner\(/);
  });

  it("hostelProvisioningService.provision (the wizard's one-shot path) calls subscriptionService.ensureForOwner", () => {
    const src = read("lib/services/hostel-provisioning-service.ts");
    expect(src).toMatch(/subscriptionService\s*\.\s*ensureForOwner\(/);
  });

  it("the Subscription page's own read model documents ensureForOwner as a fallback, not the primary trigger", () => {
    const src = read("src/services/platform-billing/subscription-service.ts");
    expect(src).toMatch(/PRIMARY caller[\s\S]*hostel creation/);
    expect(src).toMatch(/defensive fallback/);
  });
});

// ── circular dependency: first hostel cannot require the subscription it creates ──
describe("first-hostel creation is exempt from assertOwnerSubscriptionActive (ADR-190)", () => {
  it("POST /api/owner/hostels only calls assertOwnerSubscriptionActive when the owner already has a hostel", () => {
    const src = read("app/api/owner/hostels/route.ts");
    // The gate call must be textually AFTER an existing-hostel-count check,
    // and inside a branch guarded by it — not called unconditionally before
    // any hostel exists (which would make onboarding impossible to complete
    // once PLATFORM_BILLING_ENFORCED is on).
    const gateIndex = src.indexOf("assertOwnerSubscriptionActive(session.sub, \"owner.hostels.create\")");
    const countIndex = src.indexOf("hostels.count(");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeLessThan(gateIndex);
    expect(src).toMatch(/existingHostelCount > 0\)\s*\{\s*\n\s*await assertOwnerSubscriptionActive/);
  });

  it("hostels/provision has the same exemption", () => {
    const src = read("app/api/owner/hostels/provision/route.ts");
    const gateIndex = src.indexOf("assertOwnerSubscriptionActive(session.sub, \"owner.hostels.provision\")");
    const countIndex = src.indexOf("hostels.count(");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeLessThan(gateIndex);
    expect(src).toMatch(/existingHostelCount > 0\)\s*\{\s*\n\s*await assertOwnerSubscriptionActive/);
  });
});

// ── behavioural: classification works without the Subscription page ───────
vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    subscription_plans: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
    $executeRaw: vi.fn(async () => undefined),
  };
  return { prisma };
});
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn(async () => undefined) } }));

import { prisma } from "@/lib/db";
import { subscriptionService } from "@/src/services/platform-billing/subscription-service";

const db = prisma as any;

describe("ensureForOwner classifies Founding correctly when called ONLY from the onboarding hook (never getForOwner)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owner #1–#10 (9 already on FOUNDING) get FOUNDING without ever reading the Subscription page", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValueOnce(null); // no existing row
    db.subscription_plans.findUnique
      .mockResolvedValueOnce({ id: "starter-id", code: "STARTER" }) // placeholder
      .mockResolvedValueOnce({ id: "founding-id", code: "FOUNDING" }); // founding
    db.owner_subscriptions.count.mockResolvedValueOnce(9); // 9 slots used
    db.owner_subscriptions.create.mockResolvedValueOnce({ id: "sub-10", owner_id: "owner-10", plan_id: "founding-id", status: "PENDING_PAYMENT" });

    const created = await subscriptionService.ensureForOwner("owner-10");

    expect(created.plan_id).toBe("founding-id");
    expect(db.owner_subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan_id: "founding-id", status: "PENDING_PAYMENT" }) }),
    );
  });

  it("owner #11 (10 slots already used) falls back to STARTER placeholder, still without the Subscription page", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValueOnce(null);
    db.subscription_plans.findUnique
      .mockResolvedValueOnce({ id: "starter-id", code: "STARTER" })
      .mockResolvedValueOnce({ id: "founding-id", code: "FOUNDING" });
    db.owner_subscriptions.count.mockResolvedValueOnce(10); // full
    db.owner_subscriptions.create.mockResolvedValueOnce({ id: "sub-11", owner_id: "owner-11", plan_id: "starter-id", status: "PENDING_PAYMENT" });

    const created = await subscriptionService.ensureForOwner("owner-11");

    expect(created.plan_id).toBe("starter-id");
  });

  it("is a no-op (returns the existing row) if the owner already has a subscription — safe to call on every hostel creation", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValueOnce({ id: "sub-existing", owner_id: "owner-3", plan_id: "founding-id", status: "ACTIVE" });

    const result = await subscriptionService.ensureForOwner("owner-3");

    expect(result.id).toBe("sub-existing");
    expect(db.owner_subscriptions.create).not.toHaveBeenCalled();
  });
});
