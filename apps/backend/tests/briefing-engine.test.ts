import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { BriefingEngine } from "@/lib/services/notifications/briefing-engine";
import { dashboardService } from "@/lib/services/dashboard-service";
import crypto from "crypto";

describe("BriefingEngine Weighted Scoring Tests", () => {
  let engine: BriefingEngine;

  const ownerId = crypto.randomUUID();
  const mockOwner = { id: ownerId, name: "Test Owner", role: "OWNER", is_active: true };
  const mockHostels = [{ id: crypto.randomUUID(), name: "Sri Adithya Girls Hostel", owner_id: ownerId, is_active: true }];

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new BriefingEngine();

    // Default Profile & Hostel Spies
    vi.spyOn(prisma.profile, "findFirst").mockResolvedValue(mockOwner as any);
    vi.spyOn(prisma.hostels, "findMany").mockResolvedValue(mockHostels as any);
    
    vi.spyOn(prisma.owner_daily_briefings, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.owner_daily_briefings, "create").mockImplementation(async (args: any) => {
      return {
        id: crypto.randomUUID(),
        owner_id: args.data.owner_id,
        local_date: args.data.local_date,
        priority_type: args.data.priority_type,
        priority_payload: args.data.priority_payload,
        template_variables: args.data.template_variables,
      } as any;
    });
    vi.spyOn(prisma.owner_daily_briefings, "update").mockImplementation(async (args: any) => {
      return {
        id: args.where.id,
        priority_type: args.data.priority_type,
        priority_payload: args.data.priority_payload,
        template_variables: args.data.template_variables,
      } as any;
    });
  });

  it("Scenario 1: COLLECTIONS wins (Overdue amount = ₹1,00,000 => score 400)", async () => {
    // Spies for counts
    vi.spyOn(prisma.move_out_requests, "count").mockResolvedValue(1); // 10 score
    vi.spyOn(prisma.identificationDocument, "count").mockResolvedValue(1); // 10 score
    vi.spyOn(prisma.complaints, "count").mockResolvedValue(3); // 30 score -> total ops score = 50

    // Spy on dashboard stats
    vi.spyOn(dashboardService, "getOwnerStatsShell").mockResolvedValue({
      revenue: 200000,
      monthly_expenses: 80000, // 40% ratio => (40 - 35) * 5 = 25 score
      pending_dues: 120000,
      overdue_amount: 100000,
      overdue_count: 5,
      occupied_beds: 45,
      total_capacity: 47, // 2 vacant beds => 15 score
      vacant_beds: 2,
      intelligence: {
        tenant_movement: {
          pending_onboarding: 1, // 10 score
        },
      },
    } as any);

    const briefing = await engine.generateBriefingForOwner(ownerId, "2026-06-12");

    expect(briefing.priority_type).toBe("COLLECTIONS");
    expect(briefing.priority_payload.score).toBe(400);
    expect(briefing.template_variables.summary).toBe([
      "Today's focus: Pending rent",
      "5 overdue tenants need follow-up.",
      "Open Pending Rent to call or send reminders.",
    ].join("\n"));
  });

  it("Scenario 2: OCCUPANCY wins (20 vacant beds => score 150)", async () => {
    vi.spyOn(prisma.move_out_requests, "count").mockResolvedValue(0);
    vi.spyOn(prisma.identificationDocument, "count").mockResolvedValue(1);
    vi.spyOn(prisma.complaints, "count").mockResolvedValue(1); // total ops score = 20

    vi.spyOn(dashboardService, "getOwnerStatsShell").mockResolvedValue({
      revenue: 100000,
      monthly_expenses: 30000, // 30% ratio => 0 score
      pending_dues: 2000,
      overdue_amount: 1000, // 4 score
      overdue_count: 1,
      occupied_beds: 25,
      total_capacity: 45,
      vacant_beds: 20, // 150 score
      intelligence: {
        tenant_movement: {
          pending_onboarding: 1, // 10 score
        },
      },
    } as any);

    const briefing = await engine.generateBriefingForOwner(ownerId, "2026-06-12");

    expect(briefing.priority_type).toBe("OCCUPANCY");
    expect(briefing.priority_payload.score).toBe(150);
    expect(briefing.template_variables.summary).toBe([
      "Today's focus: Empty beds",
      "20 vacant beds can be filled.",
      "Open Vacancies to invite tenants.",
    ].join("\n"));
  });

  it("Scenario 3: ONBOARDING wins (10 pending => score 100)", async () => {
    vi.spyOn(prisma.move_out_requests, "count").mockResolvedValue(0);
    vi.spyOn(prisma.identificationDocument, "count").mockResolvedValue(1);
    vi.spyOn(prisma.complaints, "count").mockResolvedValue(1); // total ops score = 20

    vi.spyOn(dashboardService, "getOwnerStatsShell").mockResolvedValue({
      revenue: 100000,
      monthly_expenses: 30000,
      pending_dues: 2000,
      overdue_amount: 1000, // 4 score
      overdue_count: 1,
      occupied_beds: 43,
      total_capacity: 45,
      vacant_beds: 2, // 15 score
      intelligence: {
        tenant_movement: {
          pending_onboarding: 10, // 100 score
        },
      },
    } as any);

    const briefing = await engine.generateBriefingForOwner(ownerId, "2026-06-12");

    expect(briefing.priority_type).toBe("ONBOARDING");
    expect(briefing.priority_payload.score).toBe(100);
    expect(briefing.template_variables.summary).toBe([
      "Today's focus: Pending onboarding",
      "10 tenants need activation follow-up.",
      "Open Invitations to resend or review.",
    ].join("\n"));
  });

  it("Scenario 4: PROFITABILITY wins (60% expense ratio => score 125)", async () => {
    vi.spyOn(prisma.move_out_requests, "count").mockResolvedValue(0);
    vi.spyOn(prisma.identificationDocument, "count").mockResolvedValue(1);
    vi.spyOn(prisma.complaints, "count").mockResolvedValue(1); // total ops score = 20

    vi.spyOn(dashboardService, "getOwnerStatsShell").mockResolvedValue({
      revenue: 100000,
      monthly_expenses: 60000, // 60% ratio => (60 - 35) * 5 = 125 score
      pending_dues: 2000,
      overdue_amount: 1000, // 4 score
      overdue_count: 1,
      occupied_beds: 44,
      total_capacity: 45,
      vacant_beds: 1, // 7.5 score
      intelligence: {
        tenant_movement: {
          pending_onboarding: 1, // 10 score
        },
      },
    } as any);

    const briefing = await engine.generateBriefingForOwner(ownerId, "2026-06-12");

    expect(briefing.priority_type).toBe("PROFITABILITY");
    expect(briefing.priority_payload.score).toBe(125);
    expect(briefing.template_variables.summary).toBe([
      "Today's focus: Expense review",
      "Spending needs owner review.",
      "Open HMS for the full finance view.",
    ].join("\n"));
  });

  it("Scenario 5: OPERATIONS wins (15 total tasks => score 150)", async () => {
    vi.spyOn(prisma.move_out_requests, "count").mockResolvedValue(5);
    vi.spyOn(prisma.identificationDocument, "count").mockResolvedValue(5);
    vi.spyOn(prisma.complaints, "count").mockResolvedValue(5); // total ops score = 150

    vi.spyOn(dashboardService, "getOwnerStatsShell").mockResolvedValue({
      revenue: 100000,
      monthly_expenses: 30000, // 30% ratio => 0 score
      pending_dues: 2000,
      overdue_amount: 1000, // 4 score
      overdue_count: 1,
      occupied_beds: 44,
      total_capacity: 45,
      vacant_beds: 1, // 7.5 score
      intelligence: {
        tenant_movement: {
          pending_onboarding: 1, // 10 score
        },
      },
    } as any);

    const briefing = await engine.generateBriefingForOwner(ownerId, "2026-06-12");

    expect(briefing.priority_type).toBe("OPERATIONS");
    expect(briefing.priority_payload.score).toBe(150);
    expect(briefing.template_variables.summary).toBe([
      "Today's focus: Operations",
      "15 items need review.",
      "Open Move-Outs or Pending Invitations.",
    ].join("\n"));
  });

  it("Scenario 6: HEALTHY wins (All scores are 0)", async () => {
    vi.spyOn(prisma.move_out_requests, "count").mockResolvedValue(0);
    vi.spyOn(prisma.identificationDocument, "count").mockResolvedValue(0);
    vi.spyOn(prisma.complaints, "count").mockResolvedValue(0); // total ops score = 0

    vi.spyOn(dashboardService, "getOwnerStatsShell").mockResolvedValue({
      revenue: 100000,
      monthly_expenses: 30000, // 30% ratio => 0 score
      pending_dues: 0,
      overdue_amount: 0, // 0 score
      overdue_count: 0,
      occupied_beds: 45,
      total_capacity: 45,
      vacant_beds: 0, // 0 score
      intelligence: {
        tenant_movement: {
          pending_onboarding: 0, // 0 score
        },
      },
    } as any);

    const briefing = await engine.generateBriefingForOwner(ownerId, "2026-06-12");

    expect(briefing.priority_type).toBe("HEALTHY");
    expect(briefing.priority_payload.score).toBe(0);
    expect(briefing.template_variables.summary).toBe([
      "Today's focus: No urgent action",
      "Operations look clear.",
      "Search a tenant, record an expense, or invite a tenant when needed.",
    ].join("\n"));
  });
});
