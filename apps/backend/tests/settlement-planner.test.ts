import { describe, expect, it } from "vitest";
import {
  buildSettlementPlan,
  sortObligationsByPriority,
  toObligationSnapshot,
  SETTLEMENT_PRIORITY,
  SETTLEMENT_TIERS
} from "@/src/services/payments/settlement-planner";

describe("SettlementPlanner - sortObligationsByPriority", () => {
  it("sorts obligations in the correct priority order: SECURITY_DEPOSIT -> MAINTENANCE -> RENT -> EXTRA_CHARGE", () => {
    const raw = [
      { id: "1", obligation_type: "RENT", due_date: new Date("2026-06-01"), rent_month: new Date("2026-06-01") },
      { id: "2", obligation_type: "EXTRA_CHARGE", due_date: new Date("2026-06-01"), rent_month: null },
      { id: "3", obligation_type: "SECURITY_DEPOSIT", due_date: new Date("2026-06-01"), rent_month: null },
      { id: "4", obligation_type: "MAINTENANCE", due_date: new Date("2026-06-01"), rent_month: null },
    ];

    const sorted = sortObligationsByPriority(raw);
    // Business-rule priority: SD(1) → MAINTENANCE(3) → RENT(4) → EXTRA_CHARGE(6)
    expect(sorted.map(s => s.id)).toEqual(["3", "4", "1", "2"]);
  });

  it("breaks ties using due_date", () => {
    const raw = [
      { id: "1", obligation_type: "RENT", due_date: new Date("2026-07-01"), rent_month: new Date("2026-07-01") },
      { id: "2", obligation_type: "RENT", due_date: new Date("2026-06-01"), rent_month: new Date("2026-06-01") },
    ];

    const sorted = sortObligationsByPriority(raw);
    expect(sorted.map(s => s.id)).toEqual(["2", "1"]);
  });

  it("breaks ties using rent_month if due_dates are identical", () => {
    const raw = [
      { id: "1", obligation_type: "RENT", due_date: new Date("2026-06-01"), rent_month: new Date("2026-07-01") },
      { id: "2", obligation_type: "RENT", due_date: new Date("2026-06-01"), rent_month: new Date("2026-06-01") },
    ];

    const sorted = sortObligationsByPriority(raw);
    expect(sorted.map(s => s.id)).toEqual(["2", "1"]);
  });
});

describe("SettlementPlanner - buildSettlementPlan", () => {
  const policyPartialAllowed = { allow_partial: true, minimum_amount: 500 };
  const policyPartialDisabled = { allow_partial: false, minimum_amount: 500 };

  const sampleObligations = [
    {
      id: "deposit-1",
      obligation_type: "SECURITY_DEPOSIT",
      amount: 15000,
      paid: 0,
      due_date: new Date("2026-06-01"),
      rent_month: null,
      owner_id: "owner-1",
    },
    {
      id: "maint-1",
      obligation_type: "MAINTENANCE",
      amount: 1000,
      paid: 0,
      due_date: new Date("2026-06-01"),
      rent_month: null,
      owner_id: "owner-1",
    },
    {
      id: "rent-1",
      obligation_type: "RENT",
      amount: 8000,
      paid: 0,
      due_date: new Date("2026-06-05"),
      rent_month: new Date("2026-06-01"),
      owner_id: "owner-1",
    },
  ];

  it("allocates payments fully matching the outstanding obligations", () => {
    const plan = buildSettlementPlan(sampleObligations, 24000, policyPartialAllowed);

    expect(plan.payment_accepted).toBe(true);
    expect(plan.unallocated).toBe(0);
    expect(plan.total_to_settle).toBe(24000);
    expect(plan.remaining_outstanding).toBe(0);

    const deposit = plan.allocations.find(a => a.obligation_id === "deposit-1");
    const maint = plan.allocations.find(a => a.obligation_id === "maint-1");
    const rent = plan.allocations.find(a => a.obligation_id === "rent-1");

    expect(deposit?.allocated).toBe(15000);
    expect(deposit?.result).toBe("PAID");

    expect(maint?.allocated).toBe(1000);
    expect(maint?.result).toBe("PAID");

    expect(rent?.allocated).toBe(8000);
    expect(rent?.result).toBe("PAID");
  });

  it("reports excess as unallocated rather than crediting it", () => {
    const plan = buildSettlementPlan(sampleObligations, 25600, policyPartialAllowed);

    expect(plan.payment_accepted).toBe(true);
    expect(plan.unallocated).toBe(1600);
    expect(plan.total_to_settle).toBe(24000);
    expect(plan.remaining_outstanding).toBe(0);
    expect(plan.warnings).toContain(
      "₹1,600 exceeds every settleable installment and cannot be accepted",
    );
  });

  it("applies policy minimum check when partial payments are allowed", () => {
    const lowPaymentPlan = buildSettlementPlan(sampleObligations, 400, policyPartialAllowed);
    expect(lowPaymentPlan.payment_accepted).toBe(false);
    expect(lowPaymentPlan.rejection_reason).toBe("Minimum payment is ₹500");

    const validPaymentPlan = buildSettlementPlan(sampleObligations, 500, policyPartialAllowed);
    expect(validPaymentPlan.payment_accepted).toBe(true);
  });

  it("requires first incomplete tier total when partial payments are disabled", () => {
    // Tier 1 (Onboarding): Security Deposit (15000) + Maintenance (1000) = 16000
    // If tenant pays 15000, it is rejected because full onboarding tier is 16000
    const planRejected = buildSettlementPlan(sampleObligations, 15000, policyPartialDisabled);
    expect(planRejected.payment_accepted).toBe(false);
    expect(planRejected.minimum_allowed).toBe(16000);
    expect(planRejected.rejection_reason).toContain("Full payment required. Minimum: ₹16,000 (Onboarding Dues)");

    // If tenant pays 16000, it is accepted
    const planAccepted = buildSettlementPlan(sampleObligations, 16000, policyPartialDisabled);
    expect(planAccepted.payment_accepted).toBe(true);
    expect(planAccepted.total_to_settle).toBe(16000);
  });

  it("computes next incomplete tier minimum when previous tier is already fully paid", () => {
    const partiallyPaidObligations = [
      {
        id: "deposit-1",
        obligation_type: "SECURITY_DEPOSIT",
        amount: 15000,
        paid: 15000, // Fully paid
        due_date: new Date("2026-06-01"),
        rent_month: null,
        owner_id: "owner-1",
      },
      {
        id: "maint-1",
        obligation_type: "MAINTENANCE",
        amount: 1000,
        paid: 1000, // Fully paid
        due_date: new Date("2026-06-01"),
        rent_month: null,
        owner_id: "owner-1",
      },
      {
        id: "rent-1",
        obligation_type: "RENT",
        amount: 8000,
        paid: 0,
        due_date: new Date("2026-06-05"),
        rent_month: new Date("2026-06-01"),
        owner_id: "owner-1",
      },
    ];

    // Onboarding tier is complete. Next is Recurring (Rent) = 8000
    const plan = buildSettlementPlan(partiallyPaidObligations, 7000, policyPartialDisabled);
    expect(plan.payment_accepted).toBe(false);
    expect(plan.minimum_allowed).toBe(8000);
    expect(plan.rejection_reason).toContain("Full payment required. Minimum: ₹8,000 (Rent)");
  });

  it("handles the case with no outstanding obligations (all paid)", () => {
    const allPaid = [
      {
        id: "rent-1",
        obligation_type: "RENT",
        amount: 8000,
        paid: 8000,
        due_date: new Date("2026-06-05"),
        rent_month: new Date("2026-06-01"),
        owner_id: "owner-1",
      },
    ];

    const plan = buildSettlementPlan(allPaid, 2000, policyPartialDisabled);
    expect(plan.payment_accepted).toBe(true);
    expect(plan.minimum_allowed).toBe(1);
    expect(plan.unallocated).toBe(2000);
    expect(plan.total_to_settle).toBe(0);
  });
});

describe("SettlementPlanner - toObligationSnapshot", () => {
  it("converts standard Prisma relations to the correct snapshot shape", () => {
    const prismaRow = {
      id: "ob-1",
      obligation_type: "RENT",
      amount: "8000.00",
      due_date: new Date("2026-06-05"),
      rent_month: new Date("2026-06-01"),
      owner_id: "owner-1",
      payments: [
        { amount_paid: "2000.00" },
        { amount_paid: "1500.00" },
      ],
    };

    const snapshot = toObligationSnapshot(prismaRow);
    expect(snapshot.id).toBe("ob-1");
    expect(snapshot.obligation_type).toBe("RENT");
    expect(snapshot.amount).toBe(8000);
    expect(snapshot.paid).toBe(3500);
    expect(snapshot.due_date).toBeInstanceOf(Date);
    expect(snapshot.rent_month).toBeInstanceOf(Date);
  });
});
