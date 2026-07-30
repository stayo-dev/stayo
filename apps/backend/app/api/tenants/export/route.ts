export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { financialService } from "@/src/services/payments/financial-service";
import { activationFinancialStatusService } from "@/src/services/tenants/activation-financial-status-service";

const CSV_HEADERS = [
  "Tenant Name",
  "Tenant Phone",
  "Tenant Email",
  "Hostel",
  "Floor",
  "Room",
  "Bed",
  "Joined Date",
  "Agreement Start",
  "Agreement End",
  "Agreement Duration",
  "Monthly Rent",
  "Security Deposit Required",
  "Security Deposit Paid",
  "Security Deposit Pending",
  "Maintenance Amount",
  "Maintenance Type",
  "Billing Frequency",
  "Outstanding Balance",
  "Overdue Balance",
  "Credit Balance",
  "Last Payment Date",
  "Last Payment Amount",
  "Agreement Status",
  "Tenant Status",
];

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");
    if (!hostelId) {
      return apiError("hostelId is required", "BAD_REQUEST", 400);
    }

    const ownerId = session.role === "OWNER"
      ? session.owner_id || session.sub
      : searchParams.get("ownerId");

    if (!ownerId) {
      return apiError("ownerId is required", "BAD_REQUEST", 400);
    }

    await requireHostelBelongsToOwner(ownerId, hostelId);

    // Fetch all active allocations in the hostel to assign bed indexes deterministically
    const activeAllocations = await prisma.roomAllocation.findMany({
      where: {
        hostel_id: hostelId,
        is_active: true,
        end_date: null,
      },
      orderBy: { start_date: "asc" },
    });

    const bedMap = new Map<string, string>();
    const roomGroups: Record<string, typeof activeAllocations> = {};
    for (const alloc of activeAllocations) {
      if (!roomGroups[alloc.room_id]) {
        roomGroups[alloc.room_id] = [];
      }
      roomGroups[alloc.room_id].push(alloc);
    }
    for (const roomId in roomGroups) {
      const sorted = roomGroups[roomId].sort(
        (a, b) => a.start_date.getTime() - b.start_date.getTime() || a.id.localeCompare(b.id)
      );
      sorted.forEach((alloc, index) => {
        bedMap.set(alloc.id, `Bed ${index + 1}`);
      });
    }

    // Fetch all tenants for this hostel
    const tenants = await prisma.tenants.findMany({
      where: {
        hostel_id: hostelId,
        owner_id: ownerId,
      },
      include: {
        profiles: true,
        hostels: {
          select: { name: true },
        },
        room_allocations: {
          include: {
            room: {
              include: {
                floor_ref: true,
              },
            },
          },
        },
        agreements: {
          where: {
            status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] },
          },
          orderBy: { generated_at: "desc" },
        },
        tenant_financial_ledger: {
          orderBy: { created_at: "desc" },
        },
        tenant_invitations: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { name: true, email: true, phone: true },
        },
        payments: {
          select: {
            amount_paid: true,
            payment_date: true,
          },
        },
      },
      orderBy: { joined_on: "desc" },
    });

    const rows: string[][] = [];

    for (const tenant of tenants) {
      // 1. Tenant identity
      const name = tenant.profiles?.name ?? tenant.tenant_invitations?.[0]?.name ?? tenant.name ?? "";
      const phone = tenant.profiles?.phone ?? tenant.phone_1 ?? tenant.tenant_invitations?.[0]?.phone ?? "";
      const email = tenant.profiles?.email ?? tenant.personal_email ?? tenant.tenant_invitations?.[0]?.email ?? "";

      // 2. Hostel, floor, room, bed
      const activeAllocation = tenant.room_allocations.find((a) => a.is_active && !a.end_date);
      const hostelName = tenant.hostels?.name ?? "";
      const floorName = activeAllocation?.room?.floor_ref?.name ?? (activeAllocation?.room?.floor ? String(activeAllocation.room.floor) : "");
      const roomNo = activeAllocation?.room?.room_no ?? "";
      const bedNo = activeAllocation ? (bedMap.get(activeAllocation.id) || "Bed 1") : "";

      // 3. Joined date
      const joinedDate = csvDate(tenant.joined_on);

      // 4. Agreement details
      const activeAgreement = tenant.agreements?.[0] || null;
      const agreementStart = activeAgreement ? csvDate(activeAgreement.agreement_start_date) : "";
      const agreementEnd = activeAgreement ? csvDate(activeAgreement.agreement_end_date) : "";
      const agreementDuration = activeAgreement?.agreement_duration_months
        ? `${activeAgreement.agreement_duration_months} Months`
        : "";

      // 5. Monthly rent
      const monthlyRent = activeAgreement
        ? Number(activeAgreement.contract_rent ?? tenant.monthly_rent ?? 0)
        : Number(tenant.monthly_rent ?? 0);

      // 6, 7, 8. Security Deposit Required, Paid, Pending
      let requiredDeposit = Number(tenant.security_deposit || 0);
      let paidDeposit = 0;
      let pendingDeposit = 0;

      try {
        const depositStatus = await activationFinancialStatusService.getActivationFinancialStatus(tenant.id);
        requiredDeposit = depositStatus.requiredDeposit;
        paidDeposit = depositStatus.paidDeposit;
        pendingDeposit = depositStatus.depositOutstanding;
      } catch (err) {
        requiredDeposit = activeAgreement
          ? Number(activeAgreement.contract_security_deposit ?? tenant.security_deposit ?? 0)
          : Number(tenant.security_deposit ?? 0);
        paidDeposit = 0;
        pendingDeposit = Math.max(0, requiredDeposit - paidDeposit);
      }

      // 9, 10. Maintenance amount, type
      const maintenanceAmount = activeAgreement
        ? Number(activeAgreement.contract_maintenance ?? tenant.maintenance_charge ?? 0)
        : Number(tenant.maintenance_charge ?? 0);
      const maintenanceType = activeAgreement
        ? (activeAgreement.contract_maintenance_type ?? tenant.maintenance_type ?? "NONE")
        : (tenant.maintenance_type ?? "NONE");

      // 11. Billing frequency
      const billingFrequency = activeAgreement
        ? (activeAgreement.contract_payment_frequency ?? tenant.payment_frequency ?? "MONTHLY")
        : (tenant.payment_frequency ?? "MONTHLY");

      // 12, 13. Outstanding & Overdue Balances
      let outstandingBalance = 0;
      let overdueBalance = 0;
      const now = new Date();

      try {
        const dues = await financialService.getTenantDues(tenant.id, ownerId, hostelId);
        outstandingBalance = dues.total_due;
        overdueBalance = dues.items
          .filter((item) => item.due_date && new Date(item.due_date).getTime() < now.getTime())
          .reduce((sum, item) => sum + item.outstanding, 0);
      } catch (err) {
        // no-op
      }

      // 14. Credit balance
      const creditBalance = Number(tenant.tenant_financial_ledger?.[0]?.balance_after ?? 0);

      // 15. Last payment details
      let lastPaymentDate = "";
      let lastPaymentAmount = "";
      if (tenant.payments && tenant.payments.length > 0) {
        const sortedPayments = [...tenant.payments].sort(
          (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
        );
        lastPaymentDate = csvDate(sortedPayments[0].payment_date);
        lastPaymentAmount = String(sortedPayments[0].amount_paid);
      }

      // 16, 17. Statuses
      const agreementStatus = activeAgreement ? activeAgreement.status : "No Agreement";
      const tenantStatus = tenant.status;

      rows.push([
        name,
        phone,
        email,
        hostelName,
        floorName,
        roomNo,
        bedNo,
        joinedDate,
        agreementStart,
        agreementEnd,
        agreementDuration,
        String(monthlyRent),
        String(requiredDeposit),
        String(paidDeposit),
        String(pendingDeposit),
        String(maintenanceAmount),
        maintenanceType,
        billingFrequency,
        String(outstandingBalance),
        String(overdueBalance),
        String(creditBalance),
        lastPaymentDate,
        lastPaymentAmount,
        agreementStatus,
        tenantStatus,
      ]);
    }

    const csv = [
      CSV_HEADERS.join(","),
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\n");

    return new NextResponse(`${csv}\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tenant-master-export.csv"',
      },
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to export tenant master report");
  }
}
