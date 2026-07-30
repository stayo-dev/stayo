import { prisma } from "@/lib/db";
import { dashboardService } from "@/lib/services/dashboard-service";
import { getLogger } from "@/lib/logger";

const logger = getLogger("briefing.engine");

export type BriefingPriorityType = "COLLECTIONS" | "ONBOARDING" | "OCCUPANCY" | "PROFITABILITY" | "OPERATIONS" | "HEALTHY";

export interface BriefingPayload {
  priorityType: BriefingPriorityType;
  priorityPayload: any;
  templateVariables: {
    ownerName: string;
    date: string;
    summary: string;
    hostelNames: string[];
    [key: string]: any;
  };
}

type PriorityScore = {
  type: BriefingPriorityType;
  score: number;
};

export class BriefingEngine {
  /**
   * Generates a versioned daily briefing for a hostel owner, calculates their priority topic,
   * creates/updates the briefing in the owner_daily_briefings table, and returns the briefing.
   */
  async generateBriefingForOwner(
    ownerId: string,
    localDate: string,
    timezone: string = "Asia/Kolkata"
  ): Promise<any> {
    logger.info("generating_briefing", { ownerId, localDate, timezone });

    // 1. Fetch owner profile
    const owner = await prisma.profile.findFirst({
      where: { id: ownerId, role: "OWNER", is_active: true },
    });
    if (!owner) {
      throw new Error(`Owner profile not found or inactive for ID: ${ownerId}`);
    }

    // 2. Fetch active hostels
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
      order: { name: "asc" } as any, // fallback ordering if raw client
    });

    if (hostels.length === 0) {
      const emptyPayload: BriefingPayload = {
        priorityType: "HEALTHY",
        priorityPayload: {},
        templateVariables: {
          ownerName: owner.name || "Owner",
          date: localDate,
          summary: "No active hostels found. Register hostels to start receiving briefings.",
          hostelNames: [],
        },
      };

      return this.upsertBriefingRecord(ownerId, localDate, timezone, emptyPayload);
    }

    // 3. Query stats for all hostels
    const statsList = [];
    for (const hostel of hostels) {
      try {
        const stats = await dashboardService.getOwnerStatsShell(ownerId, hostel.id);
        statsList.push({ hostel, stats });
      } catch (err: any) {
        logger.error("hostel_stats_failed", { hostelId: hostel.id, error: err.message });
      }
    }

    // 4. Aggregate metrics
    let totalRevenue = 0;
    let totalExpenses = 0;
    let totalPendingDues = 0;
    let totalOverdueAmount = 0;
    let totalOverdueCount = 0;
    let totalOccupiedBeds = 0;
    let totalCapacity = 0;
    let totalVacantBeds = 0;
    let totalPendingOnboarding = 0;
    let totalAlertsCount = 0;
    const allAlerts: any[] = [];
    const hostelNames = hostels.map((h: any) => h.name);

    for (const item of statsList) {
      const s = item.stats;
      totalRevenue += Number(s.revenue || s.monthly_revenue || s.rent_collected_this_month || 0);
      totalExpenses += Number(s.monthly_expenses || s.expenses_this_month || 0);
      totalPendingDues += Number(s.pending_dues || 0);
      totalOverdueAmount += Number(s.overdue_amount || 0);
      totalOverdueCount += Number(s.overdue_count || s.overdue_tenants || 0);
      totalOccupiedBeds += Number(s.occupied_beds || 0);
      totalCapacity += Number(s.total_capacity || 0);
      totalVacantBeds += Number(s.vacant_beds || 0);
      totalPendingOnboarding += Number(s.intelligence?.tenant_movement?.pending_onboarding || 0);
      
      const hostelAlerts = s.intelligence?.alerts || [];
      totalAlertsCount += hostelAlerts.length;
      allAlerts.push(...hostelAlerts);
    }

    const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupiedBeds / totalCapacity) * 100) : 0;
    const expenseRatio = totalRevenue > 0 ? Math.round((totalExpenses / totalRevenue) * 100) : 0;

    // 5. Evaluate priority scores using weighted scoring formula
    const collectionsScore = totalOverdueAmount * 0.004;
    const occupancyScore = totalVacantBeds * 7.5;
    const onboardingScore = totalPendingOnboarding * 10;
    const profitabilityScore = expenseRatio > 35 ? (expenseRatio - 35) * 5 : 0;

    // Fetch operational tasks counts
    const pendingMoveOuts = await prisma.move_out_requests.count({
      where: {
        owner_id: ownerId,
        status: {
          in: [
            "REQUESTED",
            "SETTLEMENT_PENDING",
            "SETTLEMENT_APPROVED",
            "PHYSICALLY_VACATED",
            "SETTLEMENT_PENDING_PAYMENT",
            "APPROVED",
            "VACATED",
          ],
        },
      },
    });
    const pendingDocReviews = await prisma.identificationDocument.count({
      where: { tenant: { owner_id: ownerId }, is_active: true, document_status: "PENDING" },
    });
    const pendingComplaints = await prisma.complaints.count({
      where: { owner_id: ownerId, status: "PENDING" },
    });
    const totalOperationsTasks = pendingMoveOuts + pendingDocReviews + pendingComplaints;
    const operationsScore = totalOperationsTasks * 10;

    // Find the highest score
    const scores: PriorityScore[] = [
      { type: "COLLECTIONS" as const, score: collectionsScore },
      { type: "OCCUPANCY" as const, score: occupancyScore },
      { type: "ONBOARDING" as const, score: onboardingScore },
      { type: "PROFITABILITY" as const, score: profitabilityScore },
      { type: "OPERATIONS" as const, score: operationsScore },
    ];

    // Find the winner (highest score > 0)
    let winner = scores.reduce<PriorityScore>(
      (prev, current) => (current.score > prev.score ? current : prev),
      { type: "HEALTHY" as const, score: 0 }
    );

    const priorityType: BriefingPriorityType = winner.score > 0 ? winner.type : "HEALTHY";
    let priorityPayload: any = {};
    let summaryText = "";

    if (priorityType === "COLLECTIONS") {
      priorityPayload = {
        totalOverdue: totalOverdueAmount,
        overdueCount: totalOverdueCount,
        totalPending: totalPendingDues,
        score: collectionsScore,
      };
      const tenantLabel = totalOverdueCount === 1 ? "tenant" : "tenants";
      summaryText = [
        "Today's focus: Pending rent",
        `${totalOverdueCount} overdue ${tenantLabel} need follow-up.`,
        "Open Pending Rent to call or send reminders.",
      ].join("\n");
    } else if (priorityType === "ONBOARDING") {
      priorityPayload = {
        pendingOnboardingCount: totalPendingOnboarding,
        score: onboardingScore,
      };
      const tenantLabel = totalPendingOnboarding === 1 ? "tenant" : "tenants";
      summaryText = [
        "Today's focus: Pending onboarding",
        `${totalPendingOnboarding} ${tenantLabel} need activation follow-up.`,
        "Open Invitations to resend or review.",
      ].join("\n");
    } else if (priorityType === "OCCUPANCY") {
      priorityPayload = {
        vacantBeds: totalVacantBeds,
        occupancyRate,
        occupiedBeds: totalOccupiedBeds,
        totalCapacity,
        score: occupancyScore,
      };
      const bedLabel = totalVacantBeds === 1 ? "bed" : "beds";
      summaryText = [
        "Today's focus: Empty beds",
        `${totalVacantBeds} vacant ${bedLabel} can be filled.`,
        "Open Vacancies to invite tenants.",
      ].join("\n");
    } else if (priorityType === "PROFITABILITY") {
      priorityPayload = {
        monthlyExpenses: totalExpenses,
        expenseRatio,
        totalRevenue,
        score: profitabilityScore,
      };
      summaryText = [
        "Today's focus: Expense review",
        "Spending needs owner review.",
        "Open HMS for the full finance view.",
      ].join("\n");
    } else if (priorityType === "OPERATIONS") {
      priorityPayload = {
        pendingMoveOuts,
        pendingDocReviews,
        pendingComplaints,
        totalOperationsTasks,
        score: operationsScore,
      };
      const taskLabel = totalOperationsTasks === 1 ? "item" : "items";
      summaryText = [
        "Today's focus: Operations",
        `${totalOperationsTasks} ${taskLabel} need review.`,
        "Open Move-Outs or Pending Invitations.",
      ].join("\n");
    } else {
      priorityPayload = {
        score: 0,
      };
      summaryText = [
        "Today's focus: No urgent action",
        "Operations look clear.",
        "Search a tenant, record an expense, or invite a tenant when needed.",
      ].join("\n");
    }

    const payload: BriefingPayload = {
      priorityType,
      priorityPayload,
      templateVariables: {
        ownerName: owner.name || "Owner",
        date: localDate,
        summary: summaryText,
        hostelNames,
        totalRevenue,
        totalExpenses,
        totalPendingDues,
        occupancyRate,
      },
    };

    return this.upsertBriefingRecord(ownerId, localDate, timezone, payload);
  }

  private async upsertBriefingRecord(
    ownerId: string,
    localDate: string,
    timezone: string,
    payload: BriefingPayload
  ): Promise<any> {
    const templateName = "owner_daily_briefing_v1";
    const templateVersion = 1;

    // Check if record exists
    const existing = await prisma.owner_daily_briefings.findUnique({
      where: {
        owner_id_local_date: {
          owner_id: ownerId,
          local_date: localDate,
        },
      },
    });

    if (existing) {
      return prisma.owner_daily_briefings.update({
        where: {
          id: existing.id,
        },
        data: {
          priority_type: payload.priorityType,
          priority_payload: payload.priorityPayload,
          template_variables: payload.templateVariables,
          updated_at: new Date(),
        },
      });
    } else {
      return prisma.owner_daily_briefings.create({
        data: {
          owner_id: ownerId,
          local_date: localDate,
          timezone,
          template_name: templateName,
          template_version: templateVersion,
          priority_type: payload.priorityType,
          priority_payload: payload.priorityPayload,
          template_variables: payload.templateVariables,
          delivery_status: "PENDING",
        },
      });
    }
  }
}

export const briefingEngine = new BriefingEngine();
