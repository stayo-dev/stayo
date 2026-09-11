import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = { owner_subscriptions: { findUnique: vi.fn() } };
  return { prisma };
});
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { prisma } from "@/lib/db";
import { assertOwnerSubscriptionActive } from "@/src/services/platform-billing/subscription-http";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";

const db = prisma as any;
const BACKEND = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(BACKEND, rel), "utf8");

function setEnforced(on: boolean) {
  if (on) process.env.PLATFORM_BILLING_ENFORCED = "true";
  else delete process.env.PLATFORM_BILLING_ENFORCED;
}
beforeEach(() => {
  vi.clearAllMocks();
  setEnforced(true);
});
afterEach(() => setEnforced(false));

// ── the guard behaviour ───────────────────────────────────────────────────
describe("assertOwnerSubscriptionActive (enforced)", () => {
  it("allows an ACTIVE owner", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status: "ACTIVE", admin_override_until: null });
    await expect(assertOwnerSubscriptionActive("owner-A", "test")).resolves.toBeUndefined();
  });

  it.each(["PENDING_PAYMENT", "PAUSED", "CANCELLED", "TRIAL", "EXPIRED"])("blocks a %s owner with 402", async (status) => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status, admin_override_until: null });
    await expect(assertOwnerSubscriptionActive("owner-A", "test")).rejects.toMatchObject({
      code: "SUBSCRIPTION_INACTIVE",
      status: 402,
    });
  });

  it("blocks an owner with no subscription", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue(null);
    await expect(assertOwnerSubscriptionActive("owner-A", "test")).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" });
  });

  it("a valid admin override lets a PAUSED owner through", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      status: "PAUSED",
      admin_override_until: new Date(Date.now() + 86400000),
    });
    await expect(assertOwnerSubscriptionActive("owner-A", "test")).resolves.toBeUndefined();
  });

  it("queries the passed ownerId — never a different one", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status: "ACTIVE", admin_override_until: null });
    await assertOwnerSubscriptionActive("owner-A", "test");
    expect(db.owner_subscriptions.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { owner_id: "owner-A" } }),
    );
  });
});

describe("assertOwnerSubscriptionActive (warn-only, flag off)", () => {
  beforeEach(() => setEnforced(false));

  it("does NOT throw for a blocked owner — logs and returns", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status: "PAUSED", admin_override_until: null });
    await expect(assertOwnerSubscriptionActive("owner-A", "hostels.id.patch")).resolves.toBeUndefined();
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_ENFORCEMENT_SKIPPED", "owner-A", expect.any(Object));
  });

  it("swallows an infra error so a wired route can never break during the ramp", async () => {
    db.owner_subscriptions.findUnique.mockRejectedValue(new Error("db down"));
    await expect(assertOwnerSubscriptionActive("owner-A", "rooms")).resolves.toBeUndefined();
  });
});

// ── billing / payment routes stay accessible while blocked ─────────────────
describe("billing and payment submission remain accessible while PENDING_PAYMENT / PAUSED", () => {
  it("a PENDING_PAYMENT owner can submit a subscription payment", async () => {
    const svc = subscriptionPaymentService as any;
    // submitPayment resolves the plan, ensures the subscription, checks no pending
    // payment, and creates the row — it never calls requireActiveSubscription.
    const src = read("src/services/platform-billing/subscription-payment-service.ts");
    expect(src).not.toMatch(/requireActiveSubscription|assertOwnerSubscriptionActive/);
    expect(typeof svc.submitPayment).toBe("function");
  });

  it("the owner subscription read + payment + plans + upgrade-preview routes do NOT gate on an active subscription", () => {
    for (const rel of [
      "app/api/owner/subscription/route.ts",
      "app/api/owner/subscription/payments/route.ts",
      "app/api/owner/subscription/plans/route.ts",
      "app/api/owner/subscription/upgrade-preview/route.ts",
    ]) {
      expect(read(rel)).not.toMatch(/assertOwnerSubscriptionActive|requireActiveSubscription/);
    }
  });

  it("auth, payment (tenant-rent), and move-out routes are NOT gated", () => {
    for (const rel of [
      "app/api/auth/login/route.ts",
      "app/api/payments/route.ts",
      "app/api/owner/payments/offline/route.ts",
      "app/api/move-out/requests/route.ts",
      "app/api/owner/kyc-documents/route.ts",
      "app/api/owner/payout-account/route.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/assertOwnerSubscriptionActive/);
    }
  });
});

// ── protected owner mutation routes ───────────────────────────────────────
describe("owner platform-management mutation routes carry the guard", () => {
  const PROTECTED = [
    "app/api/hostels/[id]/route.ts",
    "app/api/hostels/[id]/preferences/route.ts",
    "app/api/hostels/[id]/house-rules/route.ts",
    "app/api/hostels/[id]/billing-defaults/route.ts",
    "app/api/hostels/[id]/invite-defaults/route.ts",
    "app/api/hostels/[id]/meal-timings/route.ts",
    "app/api/hostels/[id]/logo/route.ts",
    "app/api/hostels/[id]/permanent/route.ts",
    "app/api/owner/hostels/route.ts",
    "app/api/owner/hostels/provision/route.ts",
    "app/api/owner/hostels/reorder/route.ts",
    "app/api/owner/me/preferences/route.ts",
    "app/api/owner/hostels/[id]/agreement-template/route.ts",
    "app/api/rooms/route.ts",
    "app/api/rooms/[id]/route.ts",
    "app/api/rooms/reorder/route.ts",
    "app/api/floors/route.ts",
    "app/api/floors/[id]/route.ts",
    "app/api/floors/[id]/rooms/route.ts",
    "app/api/tenants/route.ts",
    "app/api/tenants/[id]/route.ts",
    "app/api/tenants/[id]/change-rent/route.ts",
    "app/api/tenants/[id]/change-frequency/route.ts",
    "app/api/tenants/[id]/change-frequency/custom/route.ts",
    "app/api/tenants/transfer/route.ts",
    "app/api/tenants/increment-year/route.ts",
    "app/api/allocations/route.ts",
    "app/api/allocations/shift/route.ts",
    "app/api/announcements/route.ts",
    "app/api/hostel-events/route.ts",
    "app/api/utility-status/route.ts",
    "app/api/expenses/route.ts",
    "app/api/food/schedules/route.ts",
    "app/api/food/menu-items/route.ts",
    "app/api/food/polls/route.ts",
    "app/api/food/voting-periods/route.ts",
  ];

  it.each(PROTECTED)("%s calls assertOwnerSubscriptionActive", (rel) => {
    expect(read(rel)).toMatch(/assertOwnerSubscriptionActive\(/);
  });

  it("the guard never appears inside a GET handler", () => {
    for (const rel of PROTECTED) {
      const src = read(rel);
      // crude: split at each `export async function`, check GET blocks are clean
      const blocks = src.split(/export async function /).slice(1);
      for (const b of blocks) {
        if (b.startsWith("GET")) {
          expect(b, `${rel} GET`).not.toMatch(/assertOwnerSubscriptionActive/);
        }
      }
    }
  });
});

// ── the five tenant activation guards remain in place ─────────────────────
describe("the five Phase-3 tenant activation guards are still wired", () => {
  it.each([
    ["src/services/tenants/owner-managed-tenancy-service.ts", "owner-managed-invite"],
    ["src/services/tenants/tenant-invitation-lifecycle-service.ts", "invitation-complete-activation"],
    ["src/services/tenants/activation-workflow-service.ts", "activation-workflow-legacy"],
  ])("%s guards with assertOwnerCanActivateTenant", (rel) => {
    expect(read(rel)).toMatch(/assertOwnerCanActivateTenant\(/);
  });

  it("tenant-service guards both the reactivation-request approval and the direct reactivate", () => {
    const src = read("src/services/tenants/tenant-service.ts");
    expect(src).toMatch(/assertOwnerCanActivateTenant\([\s\S]*?reactivation-request-approval/);
    expect(src).toMatch(/assertOwnerCanActivateTenant\([\s\S]*?direct-reactivate-tenant/);
  });
});
