import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Phase 1 schema guard for owner subscription billing (ADR-172).
 *
 * Reads `schema.prisma` as text — no Prisma client, no database — the same
 * approach as `whatsapp-prisma-accessors.test.ts`. It pins the structural
 * decisions the spec froze so a later phase cannot quietly drift them:
 * owner-level uniqueness, integer-paise money, the exact enum value sets, and
 * isolation from the tenant-rent billing domain.
 */

const SCHEMA = readFileSync(
  path.join(__dirname, "..", "prisma", "schema.prisma"),
  "utf8",
);

const MIGRATION = readFileSync(
  path.join(
    __dirname,
    "..",
    "prisma",
    "migrations",
    "20260909000000_owner_subscription_billing_phase1",
    "migration.sql",
  ),
  "utf8",
);

const SEED_SCRIPT = readFileSync(
  path.join(__dirname, "..", "scripts", "seed-subscription-plans.ts"),
  "utf8",
);

/** Extract the body between `model <name> {` / `enum <name> {` and its closing brace. */
function block(kind: "model" | "enum", name: string): string {
  const re = new RegExp(`${kind}\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const m = SCHEMA.match(re);
  if (!m) throw new Error(`${kind} ${name} not found in schema.prisma`);
  return m[1];
}

function enumValues(name: string): string[] {
  return block("enum", name)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l.length > 0 && /^[A-Z_]+$/.test(l));
}

describe("ADR-172 subscription billing — schema", () => {
  it("owner_subscriptions.owner_id is unique (one owner = one subscription)", () => {
    const body = block("model", "owner_subscriptions");
    expect(body).toMatch(/owner_id\s+String\s+@unique\s+@db\.Uuid/);
  });

  it("subscription_plans.code is unique", () => {
    const body = block("model", "subscription_plans");
    expect(body).toMatch(/code\s+String\s+@unique/);
  });

  it("plan and payment/invoice amounts are integer paise, not Decimal", () => {
    expect(block("model", "subscription_plans")).toMatch(/price_paise\s+Int/);
    expect(block("model", "subscription_payments")).toMatch(/amount_paise\s+Int\b/);
    expect(block("model", "subscription_invoices")).toMatch(/amount_paise\s+Int\b/);
    // No Decimal money anywhere in the new tables.
    expect(block("model", "subscription_payments")).not.toMatch(/Decimal/);
    expect(block("model", "subscription_invoices")).not.toMatch(/Decimal/);
    expect(block("model", "owner_subscriptions")).not.toMatch(/Decimal/);
  });

  it("subscription status enum is exactly the six approved states", () => {
    expect(new Set(enumValues("OwnerSubscriptionStatus"))).toEqual(
      new Set(["TRIAL", "PENDING_PAYMENT", "ACTIVE", "EXPIRED", "PAUSED", "CANCELLED"]),
    );
  });

  it("subscription status enum does NOT reintroduce derived conditions", () => {
    const values = enumValues("OwnerSubscriptionStatus");
    for (const forbidden of ["RENEWAL_DUE", "PAYMENT_FAILED", "EXPIRING"]) {
      expect(values).not.toContain(forbidden);
    }
  });

  it("payment status enum's MEANINGFUL values (actually reachable by any code path) are exactly SUBMITTED / UNDER_REVIEW / APPROVED / REJECTED", () => {
    // PENDING/FAILED/CANCELLED are also present in this enum — a leftover
    // from a Phase 13 online-payment path that was built, then reverted the
    // same day by product decision (manual billing only, for now). Removing
    // them would require an additional DDL against the already-migrated
    // shared dev/production database (Postgres can't cleanly drop enum
    // values), judged unnecessary for three harmless, unused values — see
    // docs/obsidian/Database.md's Phase 13 note. No application code sets
    // them; this assertion checks the values every real code path can
    // still produce, not the enum's full physical membership.
    const meaningful = enumValues("SubscriptionPaymentStatus").filter(
      (v) => !["PENDING", "FAILED", "CANCELLED"].includes(v),
    );
    expect(new Set(meaningful)).toEqual(new Set(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]));
  });

  it("payment method enum supports UPI_MANUAL, CASH and GATEWAY", () => {
    expect(new Set(enumValues("SubscriptionPaymentMethod"))).toEqual(
      new Set(["UPI_MANUAL", "CASH", "GATEWAY"]),
    );
  });

  it("subscription_payments defaults to SUBMITTED (owners cannot self-approve)", () => {
    expect(block("model", "subscription_payments")).toMatch(
      /status\s+SubscriptionPaymentStatus\s+@default\(SUBMITTED\)/,
    );
  });

  it("payment / subscription / invoice are three separate models", () => {
    for (const m of ["owner_subscriptions", "subscription_payments", "subscription_invoices"]) {
      expect(() => block("model", m)).not.toThrow();
    }
    // One invoice per payment.
    expect(block("model", "subscription_invoices")).toMatch(/payment_id\s+String\s+@unique\s+@db\.Uuid/);
  });

  it("the new domain has NO foreign key into tenant-rent billing", () => {
    const rentModels = [
      "rent_obligations",
      "payments",
      "payment_groups",
      "payment_attempts",
      "tenant_financial_ledger",
      "settlement_items",
      "gateway_transactions",
    ];
    for (const m of ["owner_subscriptions", "subscription_payments", "subscription_invoices", "owner_billing_profiles", "subscription_plans"]) {
      const body = block("model", m);
      const relations = Array.from(
        body.matchAll(/@relation\(fields:\s*\[[^\]]+\],\s*references:\s*\[[^\]]+\]/g),
      ).map((x) => x[0]);
      for (const rentModel of rentModels) {
        expect(body.includes(` ${rentModel} `), `${m} must not reference ${rentModel}`).toBe(false);
      }
      // The only cross-model references allowed are to profile / subscription_plans / the other new tables.
      for (const rel of relations) {
        expect(rel).toMatch(/references:\s*\[id\]/);
      }
    }
  });

  it("subscription_payments carries a searchable transaction_reference index", () => {
    expect(block("model", "subscription_payments")).toMatch(/@@index\(\[transaction_reference\]\)/);
  });

  it("deprecated per-hostel tables are preserved (non-destructive migration)", () => {
    expect(() => block("model", "hostel_subscriptions")).not.toThrow();
    expect(() => block("model", "platform_invoices")).not.toThrow();
    expect(SCHEMA).toMatch(/DEPRECATED by ADR-172[\s\S]*model hostel_subscriptions/);
    expect(SCHEMA).toMatch(/DEPRECATED by ADR-172[\s\S]*model platform_invoices/);
  });

  it("capacity_max is nullable (NULL = unlimited, e.g. FOUNDING / Portfolio-custom)", () => {
    expect(block("model", "subscription_plans")).toMatch(/capacity_max\s+Int\?/);
  });

  it("seed defines FOUNDING as ₹2,000, non-public, unlimited capacity", () => {
    // migration.sql seed row: code, name, price_paise, currency, cycle, cap_min, cap_max, is_public, is_active, price_amount
    expect(MIGRATION).toMatch(
      /\(\s*'FOUNDING'\s*,\s*'Founding'\s*,\s*200000\s*,\s*'INR'\s*,\s*'MONTHLY'\s*,\s*1\s*,\s*NULL\s*,\s*FALSE\s*,\s*TRUE\s*,/i,
    );
    // seed script: FOUNDING has capacity_max: null and is_public: false
    expect(SEED_SCRIPT).toMatch(
      /code:\s*"FOUNDING"[^}]*price_paise:\s*200000[^}]*capacity_max:\s*null[^}]*is_public:\s*false/,
    );
  });

  it("normal plans keep a finite capacity_max in the seed", () => {
    for (const [code, max] of [
      ["STARTER", "60"], // 50 included + 10 extra (business rules, 2026-09-10)
      ["GROWTH", "125"], // 100 included + 25 extra
      ["PROFESSIONAL", "300"], // 250 included + 50 extra
      ["PORTFOLIO", "500"], // 500 included, no extra beds
    ] as const) {
      const re = new RegExp(`code:\\s*"${code}"[^}]*capacity_max:\\s*${max}\\b`);
      expect(SEED_SCRIPT, `${code} capacity_max ${max}`).toMatch(re);
    }
  });

  it("profile exposes the owner-level billing relations", () => {
    const body = block("model", "profile");
    expect(body).toMatch(/owner_subscription\s+owner_subscriptions\?/);
    expect(body).toMatch(/owner_billing_profile\s+owner_billing_profiles\?/);
  });
});
