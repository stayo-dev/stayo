import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const BACKEND = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(BACKEND, rel), "utf8");

const DEPRECATED_ROUTES = [
  "app/api/platform-admin/hostels/[id]/subscription/route.ts",
  "app/api/platform-admin/hostels/[id]/invoices/route.ts",
  "app/api/platform-admin/revenue/hostels/route.ts",
  // NOTE: /api/platform-admin/revenue/export was ALSO originally retired
  // here, but that was reverted when integrating billing onto `main`
  // (2026-09-11) — `main` had kept this route live and working, and the
  // merge preserved it rather than retiring existing functionality. See
  // docs/obsidian/{Changelog,APIs}.md.
];

const ACTIVE_BILLING_ROUTES = [
  "app/api/platform-admin/dashboard/route.ts",
  "app/api/platform-admin/owners/route.ts",
  "app/api/platform-admin/owners/[id]/route.ts",
  "app/api/platform-admin/revenue/route.ts",
];

describe("Phase 6.1 — legacy per-hostel billing is removed from reachable code", () => {
  it("deprecated routes no longer read or write hostel_subscriptions / platform_invoices", () => {
    for (const rel of DEPRECATED_ROUTES) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/prisma\.hostel_subscriptions/);
      expect(src, rel).not.toMatch(/prisma\.platform_invoices/);
      expect(src, rel).toMatch(/ENDPOINT_REMOVED/);
      expect(src, rel).toMatch(/410/);
    }
  });

  it("the legacy assign-plan route can no longer create a TRIAL per-hostel subscription", () => {
    const src = read("app/api/platform-admin/hostels/[id]/subscription/route.ts");
    expect(src).not.toMatch(/status:\s*"TRIAL"/);
    expect(src).not.toMatch(/14 \* 24 \* 60 \* 60 \* 1000/);
  });

  it("the legacy record-invoice route can no longer flip a subscription to ACTIVE", () => {
    const src = read("app/api/platform-admin/hostels/[id]/invoices/route.ts");
    expect(src).not.toMatch(/status:\s*"ACTIVE"/);
  });

  it("ad-hoc plan creation (POST /platform-admin/plans) is removed", () => {
    const src = read("app/api/platform-admin/plans/route.ts");
    expect(src).toMatch(/ENDPOINT_REMOVED/);
    expect(src).not.toMatch(/prisma\.subscription_plans\.create/);
  });

  it("active admin billing surfaces read the owner-level tables, not hostel_subscriptions", () => {
    for (const rel of ACTIVE_BILLING_ROUTES) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/prisma\.hostel_subscriptions/);
      expect(src, rel).not.toMatch(/prisma\.platform_invoices/);
      expect(src, rel).toMatch(/prisma\.owner_subscriptions/);
    }
  });

  it("the admin dashboard's MRR / collections come from owner_subscriptions + subscription_invoices", () => {
    const src = read("app/api/platform-admin/dashboard/route.ts");
    expect(src).toMatch(/owner_subscriptions\.findMany\(\{[\s\S]*status:\s*"ACTIVE"/);
    expect(src).toMatch(/subscription_invoices\.aggregate/);
  });

  it("the notification feed reports owner subscription invoices, not platform_invoices", () => {
    const src = read("lib/services/platform-admin-activity-service.ts");
    expect(src).not.toMatch(/prisma\.platform_invoices/);
    expect(src).toMatch(/prisma\.subscription_invoices\.findMany/);
  });
});

describe("Phase 6.1 — new owners never enter TRIAL", () => {
  it("ensureForOwner creates PENDING_PAYMENT and never TRIAL", () => {
    const src = read("src/services/platform-billing/subscription-service.ts");
    const createBlock = src.slice(src.indexOf("async function ensureForOwner"));
    expect(createBlock).toMatch(/status:\s*"PENDING_PAYMENT"/);
    expect(createBlock.slice(0, createBlock.indexOf("export"))).not.toMatch(/status:\s*"TRIAL"/);
  });

  it("no reachable service or route writes a TRIAL subscription status", () => {
    const roots = ["src/services/platform-billing", "app/api/owner/subscription", "app/api/platform-admin"];
    const { execSync } = require("child_process") as typeof import("child_process");
    for (const root of roots) {
      const hits = execSync(`grep -rn 'status:\\s*"TRIAL"' ${path.join(BACKEND, root)} || true`, {
        encoding: "utf8",
      }).trim();
      expect(hits, `${root} should not write TRIAL`).toBe("");
    }
  });
});
