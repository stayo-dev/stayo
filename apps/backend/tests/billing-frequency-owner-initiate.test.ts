import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestTenant, createTestAgreement } from "./factories/tenant-factory";
import { createTestObligation } from "./factories/payment-factory";
import { billingTransitionService } from "@/lib/services/billing-transition-service";
import { billingScheduleService } from "@/lib/services/billing-schedule-service";

describe("BillingTransitionService.ownerInitiateChange — owner-direct frequency change", () => {
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;
  });

  async function createFixture(tenantOverrides: any = {}) {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id, { monthly_rent: 8500, ...tenantOverrides });
    return { owner, hostel, tenant };
  }

  it("applies immediately — creates an APPROVED request and an ACTIVE billing plan, no tenant approval needed", async () => {
    const { owner, hostel, tenant } = await createFixture();

    const result = await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
      requested_frequency: "QUARTERLY",
      reason: "Owner test",
    });

    expect(result.request.status).toBe("APPROVED");
    expect(result.request.requested_frequency).toBe("QUARTERLY");
    expect(result.billing_plan.status).toBe("ACTIVE");
    expect(result.billing_plan.frequency).toBe("QUARTERLY");

    const updatedTenant = await prisma.tenants.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(updatedTenant.payment_frequency).toBe("QUARTERLY");
  });

  it("rejects a request for a hostel this owner doesn't own", async () => {
    const { tenant } = await createFixture();
    const otherOwner = await createTestOwner();

    await expect(
      billingTransitionService.ownerInitiateChange(otherOwner.id, tenant.id, {
        requested_frequency: "QUARTERLY",
      })
    ).rejects.toThrow("TENANT_NOT_FOUND");
  });

  it("rejects requesting the frequency the tenant is already on", async () => {
    const { owner, tenant } = await createFixture();

    await expect(
      billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
        requested_frequency: "MONTHLY",
      })
    ).rejects.toThrow("REQUESTED_FREQUENCY_ALREADY_ACTIVE");
  });

  it("rejects CUSTOM_INSTALLMENTS (not implemented yet)", async () => {
    const { owner, tenant } = await createFixture();

    await expect(
      billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
        requested_frequency: "CUSTOM_INSTALLMENTS",
      })
    ).rejects.toThrow("CUSTOM_INSTALLMENTS_NOT_AVAILABLE_IN_V1");
  });

  it("rejects a frequency the hostel policy doesn't allow (default policy has no HALF_YEARLY)", async () => {
    const { owner, tenant } = await createFixture();

    await expect(
      billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
        requested_frequency: "HALF_YEARLY",
      })
    ).rejects.toThrow("FREQUENCY_NOT_ALLOWED_BY_HOSTEL");
  });

  it("does NOT block on an older, non-overlapping overdue obligation — that debt stays untouched, alongside the new frequency", async () => {
    const { owner, hostel, tenant } = await createFixture();

    // Simulates the reported real-world case: tenant already has overdue
    // rent from before "now"; its period ends long before whatever future
    // quarterly window getNextCleanBillingPeriodDate resolves to, so it
    // genuinely doesn't overlap — must not block the frequency change.
    const overdue = await createTestObligation(tenant.id, owner.id, hostel.id, {
      obligation_type: "RENT",
      status: "PENDING",
      due_date: new Date(Date.now() - 5 * 86_400_000),
      rent_month: new Date(Date.now() - 5 * 86_400_000),
      billing_period_start: new Date(Date.now() - 35 * 86_400_000),
      billing_period_end: new Date(Date.now() - 5 * 86_400_000),
    });

    const result = await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
      requested_frequency: "QUARTERLY",
    });
    expect(result.billing_plan.frequency).toBe("QUARTERLY");

    // The old due obligation is left exactly as it was — not superseded,
    // not merged, still collectible through the normal payment flow.
    const overdueRow = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: overdue.id } });
    expect(overdueRow.is_superseded).toBe(false);
    expect(overdueRow.status).toBe("PENDING");
  });

  it("finds the next clean period instead of failing when the naive first candidate collides (the reported case: Quarterly back to Monthly when this month's rent is already activated)", async () => {
    const { owner, hostel, tenant } = await createFixture();

    const policy = await (billingTransitionService as any).getPolicy(hostel.id);
    const naiveEffectiveFrom = billingScheduleService.getNextCleanBillingPeriodDate(new Date(), "QUARTERLY", policy);
    const collidingPeriod = billingScheduleService.getPeriodForAnchor(naiveEffectiveFrom, "QUARTERLY", policy);

    // Blocks the naive first candidate — a genuine overlap with the
    // immediate next quarter window (this used to throw UNCLEAN_BILLING_PERIOD
    // outright; it should now search forward and succeed on a later period).
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      obligation_type: "RENT",
      status: "PENDING",
      due_date: collidingPeriod.start,
      rent_month: collidingPeriod.start,
      billing_period_start: collidingPeriod.start,
      billing_period_end: collidingPeriod.end,
    });

    const result = await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
      requested_frequency: "QUARTERLY",
    });

    expect(result.request.status).toBe("APPROVED");
    const resolvedEffectiveFrom = new Date(result.request.effective_from);
    expect(resolvedEffectiveFrom.getTime()).toBeGreaterThan(collidingPeriod.end.getTime());
  });

  it("does nothing to existing obligations for a NON-agreement tenant — the rolling generator already respects the new setting", async () => {
    const { owner, tenant } = await createFixture();

    const result = await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
      requested_frequency: "QUARTERLY",
    });

    expect(result.obligations_created).toBe(0);
    expect(result.obligations_superseded).toBe(0);
  });

  it("regroups a signed agreement's future monthly rent into quarterly obligations (the reported bug: setting changed but the Charges tab stayed monthly)", async () => {
    const { owner, hostel, tenant } = await createFixture();
    const agreementEnd = new Date(Date.now() + 300 * 86_400_000); // ~10 months out
    await createTestAgreement(tenant.id, hostel.id, {
      contract_rent: 8500,
      agreement_duration_months: 12,
      agreement_start_date: new Date(Date.now() - 60 * 86_400_000),
      agreement_end_date: agreementEnd,
    });

    // Simulates what agreement-rent-schedule-service.ts already generated at
    // signing: individual monthly UPCOMING rows stretching into the future.
    // Anchored to the same "next clean quarterly period" date the service
    // itself will compute, so every fixture row is safely on/after it.
    const policy = await (billingTransitionService as any).getPolicy(hostel.id);
    const effectiveFrom = billingScheduleService.getNextCleanBillingPeriodDate(new Date(), "QUARTERLY", policy);
    const futureMonthly: string[] = [];
    for (let i = 0; i < 6; i++) {
      const monthStart = new Date(Date.UTC(effectiveFrom.getUTCFullYear(), effectiveFrom.getUTCMonth() + i, 1));
      const ob = await createTestObligation(tenant.id, owner.id, hostel.id, {
        obligation_type: "RENT",
        status: "UPCOMING",
        amount: 8500,
        total_amount: 8500,
        due_date: monthStart,
        rent_month: monthStart,
      });
      futureMonthly.push(ob.id);
    }

    const result = await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, {
      requested_frequency: "QUARTERLY",
      reason: "Tenant asked to switch to quarterly",
    });

    expect(result.obligations_superseded).toBe(6);
    expect(result.obligations_created).toBeGreaterThan(0);

    // The old monthly rows are gone from the live set, replaced by quarterly ones.
    const liveRows = await prisma.rent_obligations.findMany({
      where: { tenant_id: tenant.id, obligation_type: "RENT", is_superseded: false },
    });
    for (const row of liveRows) {
      expect(Number(row.amount)).toBe(8500 * 3);
      expect(row.agreement_id).not.toBeNull();
    }

    for (const id of futureMonthly) {
      const row = await prisma.rent_obligations.findUniqueOrThrow({ where: { id } });
      expect(row.is_superseded).toBe(true);
    }
  });

  it("survives repeated back-and-forth frequency switches without hitting the (agreement_id, rent_month, obligation_type) unique constraint", async () => {
    const { owner, hostel, tenant } = await createFixture();
    await createTestAgreement(tenant.id, hostel.id, {
      contract_rent: 8500,
      agreement_duration_months: 12,
      agreement_start_date: new Date(Date.now() - 60 * 86_400_000),
      agreement_end_date: new Date(Date.now() + 300 * 86_400_000),
    });

    await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, { requested_frequency: "QUARTERLY" });
    await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, { requested_frequency: "MONTHLY" });
    // Switching back to QUARTERLY a second time lands on the same quarter
    // start dates as the first switch — those rows are now superseded but
    // still occupy the (agreement_id, rent_month, obligation_type) slot.
    // This used to throw a unique constraint violation trying to insert a
    // fresh row on top of them.
    const result = await billingTransitionService.ownerInitiateChange(owner.id, tenant.id, { requested_frequency: "QUARTERLY" });

    expect(result.request.status).toBe("APPROVED");
    const liveRows = await prisma.rent_obligations.findMany({
      where: { tenant_id: tenant.id, obligation_type: "RENT", is_superseded: false },
    });
    expect(liveRows.length).toBeGreaterThan(0);
    for (const row of liveRows) {
      expect(Number(row.amount)).toBe(8500 * 3);
    }
  });
});
