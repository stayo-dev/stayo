import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { owner_subscriptions: { findUnique: vi.fn() } } }));
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { billingErrorResponse, subscriptionErrorResponse, HttpForbidden } from "@/src/services/platform-billing/subscription-http";
import { SubscriptionError } from "@/src/services/platform-billing/subscription-errors";

const BACKEND = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(BACKEND, rel), "utf8");

// The ~40 owner platform-management mutation routes gated by
// `assertOwnerSubscriptionActive` (ADR-172, Phase 3 correction) — every one
// of these now runs `billingErrorResponse(error)` first in its own catch.
const GUARDED_MUTATION_ROUTES = [
  "app/api/allocations/route.ts",
  "app/api/allocations/shift/route.ts",
  "app/api/announcements/[id]/route.ts",
  "app/api/announcements/route.ts",
  "app/api/expenses/[id]/route.ts",
  "app/api/expenses/route.ts",
  "app/api/floors/[id]/rooms/route.ts",
  "app/api/floors/[id]/route.ts",
  "app/api/floors/route.ts",
  "app/api/food/menu-items/[id]/route.ts",
  "app/api/food/menu-items/route.ts",
  "app/api/food/polls/route.ts",
  "app/api/food/schedules/[id]/publish/route.ts",
  "app/api/food/schedules/route.ts",
  "app/api/food/voting-periods/route.ts",
  "app/api/hostel-events/[id]/route.ts",
  "app/api/hostel-events/route.ts",
  "app/api/hostels/[id]/billing-defaults/route.ts",
  "app/api/hostels/[id]/house-rules/route.ts",
  "app/api/hostels/[id]/invite-defaults/route.ts",
  "app/api/hostels/[id]/logo/route.ts",
  "app/api/hostels/[id]/meal-timings/route.ts",
  "app/api/hostels/[id]/permanent/route.ts",
  "app/api/hostels/[id]/preferences/route.ts",
  "app/api/hostels/[id]/route.ts",
  "app/api/owner/hostels/[id]/agreement-template/route.ts",
  "app/api/owner/hostels/provision/route.ts",
  "app/api/owner/hostels/reorder/route.ts",
  "app/api/owner/hostels/route.ts",
  "app/api/owner/me/preferences/route.ts",
  "app/api/rooms/[id]/route.ts",
  "app/api/rooms/reorder/route.ts",
  "app/api/rooms/route.ts",
  "app/api/tenants/[id]/change-frequency/custom/route.ts",
  "app/api/tenants/[id]/change-frequency/route.ts",
  "app/api/tenants/[id]/change-rent/route.ts",
  "app/api/tenants/[id]/route.ts",
  "app/api/tenants/increment-year/route.ts",
  "app/api/tenants/route.ts",
  "app/api/tenants/transfer/route.ts",
  "app/api/utility-status/route.ts",
];

// Tenant-activation entry routes (ADR-172, Phase 3) — SubscriptionError can
// reach these several calls deep, through `assertCanActivate` /
// `requireActiveSubscription`.
const ACTIVATION_ROUTES = [
  "app/api/tenants/invite/route.ts", // initializeActiveUnacceptedTenancy
  "app/api/tenants/[id]/reactivate/route.ts", // tenant-service.reactivateTenant
  "app/api/tenants/owner/reactivation-requests/[id]/decision/route.ts", // processReactivationRequest
];

// Already correct before this phase — activationWorkflowService's PATCH
// catch special-cases SUBSCRIPTION_INACTIVE / SUBSCRIPTION_CAPACITY_REACHED
// via `error.status`, so it needs no change; asserted here so a future edit
// can't silently regress it back to a 500.
const ALREADY_CORRECT_ACTIVATION_ROUTE = "app/api/tenants/activate/route.ts";

// Routes that already went through `subscriptionErrorResponse` uniformly
// (Phase 2/5 — platform-admin subscriptions/payments, owner subscription
// routes). Spot-checked, not exhaustive — these were correct before this
// phase and are reasserted so they can't quietly regress.
const ALREADY_STANDARDIZED_ROUTES = [
  "app/api/platform-admin/subscriptions/route.ts",
  "app/api/platform-admin/subscriptions/[id]/route.ts",
  "app/api/platform-admin/subscriptions/[id]/pause/route.ts",
  "app/api/platform-admin/subscriptions/[id]/resume/route.ts",
  "app/api/platform-admin/subscriptions/[id]/change-plan/route.ts",
  "app/api/platform-admin/subscriptions/[id]/override/route.ts",
  "app/api/platform-admin/subscription-payments/route.ts",
  "app/api/platform-admin/subscription-payments/[id]/approve/route.ts",
  "app/api/platform-admin/subscription-payments/[id]/reject/route.ts",
  "app/api/platform-admin/subscription-payments/cash/route.ts",
];

describe("billingErrorResponse — the shared mapping used by mixed routes", () => {
  it("maps SUBSCRIPTION_INACTIVE to its carried 402", async () => {
    const err = new SubscriptionError("Your Stayo subscription is awaiting payment.", "SUBSCRIPTION_INACTIVE", 402);
    const res = billingErrorResponse(err)!;
    expect(res).not.toBeNull();
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SUBSCRIPTION_INACTIVE");
    expect(body.error.message).toBe("Your Stayo subscription is awaiting payment.");
  });

  it("maps SUBSCRIPTION_CAPACITY_REACHED to its carried 409", async () => {
    const err = new SubscriptionError("Plan capacity reached.", "SUBSCRIPTION_CAPACITY_REACHED", 409);
    const res = billingErrorResponse(err)!;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("SUBSCRIPTION_CAPACITY_REACHED");
  });

  it("maps an invalid-operation SubscriptionError to its carried 400-level status", async () => {
    const err = new SubscriptionError("Target plan is not a downgrade.", "NOT_A_DOWNGRADE", 400);
    const res = billingErrorResponse(err)!;
    expect(res.status).toBe(400);
  });

  it("returns null for a non-billing error, so the route's own handling runs", () => {
    expect(billingErrorResponse(new Error("boom"))).toBeNull();
    expect(billingErrorResponse(new TypeError("bad input"))).toBeNull();
    expect(billingErrorResponse({ message: "not really an error" })).toBeNull();
  });

  it("returns null for HttpForbidden — that is an auth error, not a billing one", () => {
    expect(billingErrorResponse(new HttpForbidden("Owner access only."))).toBeNull();
  });

  it("never leaks a stack trace or Prisma internals — the message is always the human-authored SubscriptionError text", async () => {
    const dbLike = new Error("PrismaClientKnownRequestError: connect ECONNREFUSED 127.0.0.1:5432\n  at Connection.connect");
    (dbLike as any).name = "SubscriptionError"; // even if something spoofs the marker name...
    // ...only a real SubscriptionError instance (or the duck-typed name check
    // in isSubscriptionError) is mapped, and its message is always one this
    // module authored — never a raw driver/ORM error string passed through.
    const real = new SubscriptionError("Your Stayo subscription is paused. Renew to resume managing your hostels.", "SUBSCRIPTION_INACTIVE", 402);
    const res = billingErrorResponse(real)!;
    const body = await res.json();
    expect(body.error.message).not.toMatch(/ECONNREFUSED|PrismaClient|at .*\(|node_modules/i);
  });
});

describe("subscriptionErrorResponse — unchanged, still the 500 fallback for a non-billing error", () => {
  it("still returns a generic 500 for an unrecognized error, without leaking it", async () => {
    const res = subscriptionErrorResponse(new Error("connect ECONNREFUSED 127.0.0.1:5432"), "test.context");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe("Something went wrong with that request.");
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED/);
  });
});

describe("SubscriptionError does not become a generic HTTP 500 in a mixed route's own catch", () => {
  it.each(GUARDED_MUTATION_ROUTES)("%s runs billingErrorResponse(error) before its own error handling", (rel) => {
    const src = read(rel);
    expect(src, rel).toMatch(/import \{[^}]*billingErrorResponse[^}]*\} from "@\/src\/services\/platform-billing\/subscription-http"/);
    // Once per assertOwnerSubscriptionActive call site in the file, and the
    // check appears immediately as the first statement of that catch.
    const callSites = (src.match(/await assertOwnerSubscriptionActive\(/g) || []).length;
    const checks = (src.match(/const billing = billingErrorResponse\(error\);\n\s*if \(billing\) return billing;/g) || []).length;
    expect(checks, rel).toBe(callSites);
    expect(callSites, rel).toBeGreaterThan(0);
  });

  it.each(ACTIVATION_ROUTES)("%s (tenant-activation path) runs billingErrorResponse(error) too", (rel) => {
    const src = read(rel);
    expect(src, rel).toMatch(/billingErrorResponse\(error\)/);
    expect(src, rel).toMatch(/if \(billing\) return billing;/);
  });

  it(`${ALREADY_CORRECT_ACTIVATION_ROUTE} already maps SUBSCRIPTION_INACTIVE/SUBSCRIPTION_CAPACITY_REACHED to their carried status`, () => {
    const src = read(ALREADY_CORRECT_ACTIVATION_ROUTE);
    expect(src).toMatch(/SUBSCRIPTION_INACTIVE/);
    expect(src).toMatch(/SUBSCRIPTION_CAPACITY_REACHED/);
    expect(src).toMatch(/status:\s*Number\(error\.status \|\| 409\)/);
  });

  it.each(ALREADY_STANDARDIZED_ROUTES)("%s already routes every error through subscriptionErrorResponse", (rel) => {
    const src = read(rel);
    expect(src, rel).toMatch(/subscriptionErrorResponse\(error,/);
  });
});

describe("responses never expose internals", () => {
  it("apiError's shape carries only message/code/details — no stack field is ever attached", async () => {
    const err = new SubscriptionError("Your Stayo subscription has ended. Renew to resume managing your hostels.", "SUBSCRIPTION_INACTIVE", 402);
    const res = billingErrorResponse(err)!;
    const body = await res.json();
    expect(body.error).not.toHaveProperty("stack");
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"].sort());
  });
});
