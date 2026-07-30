import { prisma } from "@/lib/db";
import { onboardingFinancialsService } from "./onboarding-financials-service";
import { financialLifecycleService } from "./financial-lifecycle-service";

type Db = typeof prisma;

export type OnboardingMaintenanceRepairCandidate = {
  tenantId: string;
  ownerId: string;
  hostelId: string;
  joiningDate: Date;
  maintenanceCharge: number;
  maintenanceType: string;
};

export type OnboardingMaintenanceRepairResult = {
  dryRun: boolean;
  affectedBefore: number;
  repaired: number;
  stillMissing: number;
  skipped: Array<{ tenantId: string; reason: string }>;
  candidates: OnboardingMaintenanceRepairCandidate[];
};

function money(value: unknown) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function normalizeMaintenanceType(value: unknown) {
  return String(value || "MONTHLY").trim().toUpperCase();
}

export class OnboardingMaintenanceRepairService {
  constructor(
    private readonly db: Db = prisma,
    private readonly financials = onboardingFinancialsService
  ) {}

  async findMissingOnboardingMaintenanceCandidates(): Promise<OnboardingMaintenanceRepairCandidate[]> {
    const tenants = await this.db.tenants.findMany({
      where: {
        status: "INVITED",
        maintenance_charge: { gt: 0 },
        NOT: { maintenance_type: "NONE" },
        rent_obligations: {
          none: {
            obligation_type: "MAINTENANCE",
            is_superseded: false,
          },
        },
      },
      select: {
        id: true,
        owner_id: true,
        hostel_id: true,
        joined_on: true,
        billing_start_date: true,
        created_at: true,
        maintenance_charge: true,
        maintenance_type: true,
      },
      orderBy: { created_at: "asc" },
    });

    return tenants
      .filter((tenant: any) => tenant.owner_id && tenant.hostel_id)
      .map((tenant: any) => ({
        tenantId: tenant.id,
        ownerId: tenant.owner_id,
        hostelId: tenant.hostel_id,
        joiningDate: tenant.joined_on || tenant.billing_start_date || tenant.created_at,
        maintenanceCharge: money(tenant.maintenance_charge),
        maintenanceType: normalizeMaintenanceType(tenant.maintenance_type),
      }));
  }

  async repairMissingOnboardingMaintenance(options: { dryRun?: boolean } = {}): Promise<OnboardingMaintenanceRepairResult> {
    const dryRun = options.dryRun !== false;
    const candidates = await this.findMissingOnboardingMaintenanceCandidates();

    if (dryRun || candidates.length === 0) {
      return {
        dryRun,
        affectedBefore: candidates.length,
        repaired: 0,
        stillMissing: candidates.length,
        skipped: [],
        candidates,
      };
    }

    const skipped: Array<{ tenantId: string; reason: string }> = [];
    let repaired = 0;

    for (const candidate of candidates) {
      const joiningDate = new Date(candidate.joiningDate);
      if (Number.isNaN(joiningDate.getTime())) {
        skipped.push({ tenantId: candidate.tenantId, reason: "INVALID_JOINING_DATE" });
        continue;
      }

      const result = await this.db.$transaction(async (tx: any) => {
        const financials = await this.financials.initializeOnboardingFinancials(tx, {
          tenantId: candidate.tenantId,
          ownerId: candidate.ownerId,
          hostelId: candidate.hostelId,
          joiningDate,
          maintenanceCharge: candidate.maintenanceCharge,
          maintenanceType: candidate.maintenanceType,
        });
        if (financials.createdObligationIds.length > 0) {
          await financialLifecycleService.activatePayableObligations(tx, {
            tenantId: candidate.tenantId,
            ownerId: candidate.ownerId,
            hostelId: candidate.hostelId,
            obligationIds: financials.createdObligationIds,
          });
        }
        return financials;
      });

      if (result.createdObligations.includes("MAINTENANCE")) {
        repaired += 1;
      } else if (!result.skipped) {
        skipped.push({ tenantId: candidate.tenantId, reason: "NO_MAINTENANCE_CREATED" });
      }
    }

    const stillMissing = await this.findMissingOnboardingMaintenanceCandidates();

    return {
      dryRun,
      affectedBefore: candidates.length,
      repaired,
      stillMissing: stillMissing.length,
      skipped,
      candidates,
    };
  }
}

export const onboardingMaintenanceRepairService = new OnboardingMaintenanceRepairService();
