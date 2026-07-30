import { prisma } from "../db";
import crypto from "crypto";

export type RentGenerationLedgerStatus = "STARTED" | "COMPLETED" | "FAILED" | "SKIPPED";
export type RentGenerationTrigger = "cron" | "manual" | "backfill";

export type RentGenerationLedgerScope = {
  ownerId: string;
  hostelId: string;
  rentMonth: Date;
  obligationType: string;
};

type StartInput = RentGenerationLedgerScope & {
  triggerType: RentGenerationTrigger;
  generatedBy?: string | null;
};

type FinishInput = RentGenerationLedgerScope & {
  createdCount?: number;
  skippedCount?: number;
  reason?: string | null;
};

const scopeWhere = (scope: RentGenerationLedgerScope) => ({
  owner_id_hostel_id_rent_month_obligation_type: {
    owner_id: scope.ownerId,
    hostel_id: scope.hostelId,
    rent_month: scope.rentMonth,
    obligation_type: scope.obligationType,
  },
});

export class RentGenerationLedgerService {
  async hasCompleted(ownerId: string, hostelId: string, rentMonth: Date, obligationType: string) {
    const ledger = await prisma.rent_generation_ledgers.findUnique({
      where: scopeWhere({ ownerId, hostelId, rentMonth, obligationType }),
      select: { status: true },
    });
    return ledger?.status === "COMPLETED";
  }

  async startOrReuse(input: StartInput) {
    const data = {
      owner_id: input.ownerId,
      hostel_id: input.hostelId,
      rent_month: input.rentMonth,
      obligation_type: input.obligationType,
      status: "STARTED",
      trigger_type: input.triggerType,
      generated_by: input.generatedBy || null,
      failure_reason: null,
      started_at: new Date(),
      completed_at: null,
    };

    try {
      return await prisma.rent_generation_ledgers.create({
        data: {
          id: crypto.randomUUID(),
          ...data,
        },
      });
    } catch (err: any) {
      if (err?.code !== "P2002") throw err;
      const existing = await prisma.rent_generation_ledgers.findUnique({
        where: scopeWhere(input),
      });
      if (existing?.status === "COMPLETED") return existing;
      return prisma.rent_generation_ledgers.update({
        where: scopeWhere(input),
        data,
      });
    }
  }

  async complete(input: FinishInput) {
    return prisma.rent_generation_ledgers.update({
      where: scopeWhere(input),
      data: {
        status: "COMPLETED",
        created_count: input.createdCount ?? 0,
        skipped_count: input.skippedCount ?? 0,
        failure_reason: null,
        completed_at: new Date(),
      },
    });
  }

  async fail(input: FinishInput) {
    return prisma.rent_generation_ledgers.update({
      where: scopeWhere(input),
      data: {
        status: "FAILED",
        created_count: input.createdCount ?? 0,
        skipped_count: input.skippedCount ?? 0,
        failure_reason: input.reason || "UNKNOWN_FAILURE",
        completed_at: new Date(),
      },
    });
  }

  async skip(input: FinishInput) {
    const existing = await prisma.rent_generation_ledgers.findUnique({
      where: scopeWhere(input),
      select: { status: true, skipped_count: true },
    });

    if (existing?.status === "COMPLETED") {
      return prisma.rent_generation_ledgers.update({
        where: scopeWhere(input),
        data: { skipped_count: { increment: input.skippedCount ?? 1 } },
      });
    }

    return prisma.rent_generation_ledgers.upsert({
      where: scopeWhere(input),
      create: {
        owner_id: input.ownerId,
        hostel_id: input.hostelId,
        rent_month: input.rentMonth,
        obligation_type: input.obligationType,
        status: "SKIPPED",
        created_count: input.createdCount ?? 0,
        skipped_count: input.skippedCount ?? 0,
        failure_reason: input.reason || null,
        completed_at: new Date(),
      },
      update: {
        status: "SKIPPED",
        created_count: input.createdCount ?? 0,
        skipped_count: { increment: input.skippedCount ?? 0 },
        failure_reason: input.reason || null,
        completed_at: new Date(),
      },
    });
  }
}

export const rentGenerationLedgerService = new RentGenerationLedgerService();
