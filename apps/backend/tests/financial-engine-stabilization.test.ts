import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestTenant, allocateTestRoom } from "./factories/tenant-factory";
import { createTestRoom } from "./factories/room-factory";
import { createTestObligation, createTestPayment } from "./factories/payment-factory";
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";
import { tenantFinancialLedgerService } from "@/src/services/payments/tenant-financial-ledger-service";
import { obligationEngine } from "@/src/services/payments/obligation-engine";

describe("Financial Engine Stabilization — targeted regression coverage", () => {
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;
  });

  async function createFixture() {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const room = await createTestRoom(hostel.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
    return { owner, hostel, tenant };
  }

  describe("FinancialPaymentFacade.applyAvailableCredits", () => {
    it("respects SETTLEMENT_PRIORITY tiering — a later-due SECURITY_DEPOSIT is credited before an earlier-due RENT obligation", async () => {
      const { owner, hostel, tenant } = await createFixture();

      // RENT is due earlier by date, but SECURITY_DEPOSIT outranks RENT in
      // SETTLEMENT_PRIORITY. A pure rent_month/due_date sort (the retired
      // auto-apply's behavior) would settle RENT first; the canonical
      // planner must settle SECURITY_DEPOSIT first regardless of date.
      const rent = await createTestObligation(tenant.id, owner.id, hostel.id, {
        obligation_type: "RENT",
        amount: 5000,
        total_amount: 5000,
        due_date: new Date("2026-06-05"),
        rent_month: new Date("2026-06-01"),
        status: "PENDING",
      });
      const deposit = await createTestObligation(tenant.id, owner.id, hostel.id, {
        obligation_type: "SECURITY_DEPOSIT",
        amount: 5000,
        total_amount: 5000,
        due_date: new Date("2026-07-05"),
        rent_month: new Date("2026-07-01"),
        status: "PENDING",
      });

      await prisma.$transaction(async (tx: any) => {
        await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
          tenantId: tenant.id,
          ownerId: owner.id,
          createdBy: owner.id,
          amount: 5000,
          referenceId: crypto.randomUUID(),
          referenceType: "PAYMENT_GROUP_REMAINDER",
          reason: "FUTURE_RENT_CREDIT_TOPUP",
        });
      });

      const result = await prisma.$transaction(async (tx: any) => {
        return financialPaymentFacade.applyAvailableCredits(tx, {
          tenantId: tenant.id,
          hostelId: hostel.id,
          ownerId: owner.id,
          actorId: owner.id,
        });
      });

      expect(result).not.toBeNull();
      expect(result!.allocations).toHaveLength(1);
      expect(result!.allocations[0].obligation_id).toBe(deposit.id);

      const depositRow = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: deposit.id } });
      const rentRow = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: rent.id } });
      expect(depositRow.status).toBe("PAID");
      expect(rentRow.status).toBe("PENDING");
    });

    it("includes OVERDUE obligations (the retired auto-apply silently excluded them)", async () => {
      const { owner, hostel, tenant } = await createFixture();

      const overdue = await createTestObligation(tenant.id, owner.id, hostel.id, {
        obligation_type: "RENT",
        amount: 4000,
        total_amount: 4000,
        due_date: new Date("2026-01-05"),
        rent_month: new Date("2026-01-01"),
        status: "OVERDUE",
      });

      await prisma.$transaction(async (tx: any) => {
        await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
          tenantId: tenant.id,
          ownerId: owner.id,
          createdBy: owner.id,
          amount: 4000,
          referenceId: crypto.randomUUID(),
          referenceType: "PAYMENT_GROUP_REMAINDER",
          reason: "FUTURE_RENT_CREDIT_TOPUP",
        });
      });

      const result = await prisma.$transaction(async (tx: any) => {
        return financialPaymentFacade.applyAvailableCredits(tx, {
          tenantId: tenant.id,
          hostelId: hostel.id,
          ownerId: owner.id,
          actorId: owner.id,
        });
      });

      expect(result).not.toBeNull();
      expect(result!.allocations[0]?.obligation_id).toBe(overdue.id);

      const row = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: overdue.id } });
      expect(row.status).toBe("PAID");
      expect(row.lifecycle_status).toBe("ACTIVE");
      expect(row.settlement_status).toBe("PAID");
    });

    it("writes the lifecycle_status/settlement_status dual-write (the retired auto-apply only wrote the legacy status column)", async () => {
      const { owner, hostel, tenant } = await createFixture();

      const rent = await createTestObligation(tenant.id, owner.id, hostel.id, {
        amount: 8500,
        total_amount: 8500,
        due_date: new Date("2026-06-05"),
        rent_month: new Date("2026-06-01"),
        status: "PENDING",
      });

      await prisma.$transaction(async (tx: any) => {
        await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
          tenantId: tenant.id,
          ownerId: owner.id,
          createdBy: owner.id,
          amount: 3000,
          referenceId: crypto.randomUUID(),
          referenceType: "PAYMENT_GROUP_REMAINDER",
          reason: "FUTURE_RENT_CREDIT_TOPUP",
        });
      });

      await prisma.$transaction(async (tx: any) => {
        return financialPaymentFacade.applyAvailableCredits(tx, {
          tenantId: tenant.id,
          hostelId: hostel.id,
          ownerId: owner.id,
          actorId: owner.id,
        });
      });

      const row = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: rent.id } });
      expect(row.status).toBe("PARTIAL");
      expect(row.lifecycle_status).toBe("ACTIVE");
      expect(row.settlement_status).toBe("PARTIAL");

      const ledgerEntry = await prisma.tenant_financial_ledger.findFirst({
        where: { tenant_id: tenant.id, type: "DEBIT", reason: "FUTURE_CREDIT_APPLIED" },
      });
      expect(ledgerEntry).not.toBeNull();
      expect(Number(ledgerEntry!.amount)).toBe(3000);
    });

    it("never allocates to a superseded obligation (an 'Edit' replacement leaves the original behind with is_superseded=true and zero payments)", async () => {
      const { owner, hostel, tenant } = await createFixture();

      // Simulates the "Edit = create replacement, supersede original" pattern:
      // the superseded row is dead — it must never receive real money again,
      // even though it still has an outstanding balance and a payable status.
      const superseded = await createTestObligation(tenant.id, owner.id, hostel.id, {
        amount: 8500,
        total_amount: 8500,
        due_date: new Date("2026-06-01"),
        rent_month: new Date("2026-06-01"),
        status: "PENDING",
        is_superseded: true,
      });
      const live = await createTestObligation(tenant.id, owner.id, hostel.id, {
        amount: 8500,
        total_amount: 8500,
        due_date: new Date("2026-06-05"),
        rent_month: new Date("2026-06-01"),
        status: "PENDING",
        is_superseded: false,
      });

      await prisma.$transaction(async (tx: any) => {
        await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
          tenantId: tenant.id,
          ownerId: owner.id,
          createdBy: owner.id,
          amount: 8500,
          referenceId: crypto.randomUUID(),
          referenceType: "PAYMENT_GROUP_REMAINDER",
          reason: "FUTURE_RENT_CREDIT_TOPUP",
        });
      });

      const result = await prisma.$transaction(async (tx: any) => {
        return financialPaymentFacade.applyAvailableCredits(tx, {
          tenantId: tenant.id,
          hostelId: hostel.id,
          ownerId: owner.id,
          actorId: owner.id,
        });
      });

      expect(result).not.toBeNull();
      expect(result!.allocations).toHaveLength(1);
      expect(result!.allocations[0].obligation_id).toBe(live.id);

      const supersededRow = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: superseded.id } });
      const liveRow = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: live.id } });
      expect(supersededRow.status).toBe("PENDING");
      expect(liveRow.status).toBe("PAID");
    });
  });

  describe("ObligationEngine.bulkWaiveInTx", () => {
    it("waives a PARTIAL obligation with a proper ledger correction for exactly the outstanding amount", async () => {
      const { owner, hostel, tenant } = await createFixture();

      const partial = await createTestObligation(tenant.id, owner.id, hostel.id, {
        amount: 8500,
        total_amount: 8500,
        status: "PARTIAL",
      });
      await createTestPayment(partial.id, 3000);

      const results = await prisma.$transaction(async (tx: any) => {
        return obligationEngine.bulkWaiveInTx(tx, {
          obligationIds: [partial.id],
          reason: "Test bulk waiver",
          actorId: owner.id,
        });
      });

      expect(results).toHaveLength(1);
      expect(results[0].waivedAmount).toBe(5500); // 8500 - 3000 already paid

      const row = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: partial.id } });
      expect(row.status).toBe("WAIVED");
      expect(row.lifecycle_status).toBe("WAIVED");

      const correction = await prisma.tenant_financial_ledger.findFirst({
        where: { tenant_id: tenant.id, type: "DEBIT", reason: "OBLIGATION_WAIVER" },
      });
      expect(correction).not.toBeNull();
      expect(Number(correction!.amount)).toBe(5500);
    });

    it("skips an already-PAID obligation without aborting the rest of the batch", async () => {
      const { owner, hostel, tenant } = await createFixture();

      const alreadyPaid = await createTestObligation(tenant.id, owner.id, hostel.id, {
        amount: 5000,
        total_amount: 5000,
        status: "PAID",
      });
      const pending = await createTestObligation(tenant.id, owner.id, hostel.id, {
        amount: 6000,
        total_amount: 6000,
        due_date: new Date("2026-08-05"),
        rent_month: new Date("2026-08-01"),
        status: "PENDING",
      });

      const results = await prisma.$transaction(async (tx: any) => {
        return obligationEngine.bulkWaiveInTx(tx, {
          obligationIds: [alreadyPaid.id, pending.id],
          reason: "Test skip-on-terminal",
          actorId: owner.id,
        });
      });

      // Only the PENDING obligation should be waived; the PAID one is skipped, not thrown.
      expect(results).toHaveLength(1);
      expect(results[0].obligationId).toBe(pending.id);

      const paidRow = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: alreadyPaid.id } });
      expect(paidRow.status).toBe("PAID"); // untouched

      const pendingRow = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: pending.id } });
      expect(pendingRow.status).toBe("WAIVED");
    });
  });
});
