export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { authService } from "@/lib/services/auth-service";
import { apiError, apiResponse } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { financialService } from "@/src/services/payments/financial-service";
import { tenantFinancialLedgerService } from "@/src/services/payments/tenant-financial-ledger-service";

/**
 * GET /api/payments/quick-collect/search?search=...
 *
 * System-wide search of active tenants for recording payment.
 * Returns ranked search results matching exact/partial phone, room, name, or metadata.
 * Aggregates outstanding dues and ledger balances.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) return apiError("Unauthorized", "UNAUTHORIZED", 401);

    if (!["OWNER", "ADMIN"].includes(user.role)) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }

    const ownerId = user.owner_id || user.id;
    const url = new URL(req.url);
    const search = (url.searchParams.get("search") || "").trim();

    const where: any = {
      owner_id: ownerId,
      status: "ACTIVE",
    };

    if (search) {
      where.OR = [
        { profiles: { name: { contains: search, mode: "insensitive" } } },
        { profiles: { email: { contains: search, mode: "insensitive" } } },
        { profiles: { phone: { contains: search, mode: "insensitive" } } },
        { phone_1: { contains: search, mode: "insensitive" } },
        { phone_2: { contains: search, mode: "insensitive" } },
        { phone_3: { contains: search, mode: "insensitive" } },
        { roll_number: { contains: search, mode: "insensitive" } },
        { personal_email: { contains: search, mode: "insensitive" } },
        {
          room_allocations: {
            some: {
              is_active: true,
              end_date: null,
              room: {
                room_no: { contains: search, mode: "insensitive" }
              }
            }
          }
        }
      ];
    }

    const tenants = await prisma.tenants.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: search ? 100 : 10,
      include: {
        profiles: true,
        hostels: true,
        room_allocations: {
          where: { is_active: true },
          include: { room: true },
        },
      },
    });

    let topTenants = tenants;

    if (search) {
      const searchLower = search.toLowerCase();
      // Rank results: Exact phone > Exact room > Exact Name > Partial matches
      const rankedTenants = tenants.map((t: any) => {
        let score = 0;
        const profile = t.profiles;
        const activeAlloc = t.room_allocations?.[0];
        const roomNo = activeAlloc?.room?.room_no || "";

        const phoneNumbers = [
          profile?.phone,
          t.phone_1,
          t.phone_2,
          t.phone_3
        ].filter(Boolean).map((p: string) => p.trim());

        const name = (profile?.name || "").trim().toLowerCase();

        // 1. Exact phone match
        if (phoneNumbers.includes(search)) {
          score = 100;
        }
        // 2. Exact room number match
        else if (roomNo && roomNo.toLowerCase() === searchLower) {
          score = 80;
        }
        // 3. Exact name match
        else if (name === searchLower) {
          score = 60;
        }
        // 4. Partial phone match
        else if (phoneNumbers.some((p: string) => p.toLowerCase().includes(searchLower))) {
          score = 40;
        }
        // 5. Partial room match
        else if (roomNo && roomNo.toLowerCase().includes(searchLower)) {
          score = 30;
        }
        // 6. Partial name match
        else if (name.includes(searchLower)) {
          score = 20;
        }
        // 7. Any other match (e.g. email, roll number, etc.)
        else {
          score = 10;
        }

        return { tenant: t, score };
      });

      // Sort by score desc, then by name asc
      rankedTenants.sort((a: { tenant: any; score: number }, b: { tenant: any; score: number }) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        const nameA = a.tenant.profiles?.name || "";
        const nameB = b.tenant.profiles?.name || "";
        return nameA.localeCompare(nameB);
      });

      topTenants = rankedTenants.slice(0, 20).map((rt: { tenant: any; score: number }) => rt.tenant);
    }

    const results = await Promise.all(topTenants.map(async (t: any) => {
      const activeAlloc = t.room_allocations?.[0];
      const roomNo = activeAlloc?.room?.room_no || "N/A";

      // Fetch obligations for outstanding dues
      const obligations = await prisma.rent_obligations.findMany({
        where: {
          tenant_id: t.id,
          is_superseded: false,
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        },
        include: {
          payments: {
            select: {
              amount_paid: true,
              payment_date: true,
            }
          }
        }
      });
      const paymentSummary = financialService.getTenantPaymentSummary(t.id, obligations as any);

      // Fetch security deposit billed/paid and future rent credit
      const ledgerBalance = await tenantFinancialLedgerService.getBalance(t.id, ownerId);

      return {
        id: t.id,
        name: t.profiles?.name || "Tenant",
        phone: t.profiles?.phone || t.phone_1 || "N/A",
        email: t.profiles?.email || t.personal_email || "",
        hostel_name: t.hostels?.name || "N/A",
        hostel_id: t.hostel_id,
        room_no: roomNo,
        outstanding_dues: paymentSummary.pending_amount,
        security_deposit_billed: Number(ledgerBalance.security_deposit || 0),
        security_deposit_paid: Number(ledgerBalance.security_deposit_paid || 0),
        future_rent_credit: Number(ledgerBalance.future_rent_credit || 0),
        status: t.status,
      };
    }));

    return apiResponse(results);
  } catch (error: any) {
    console.error("[quick-collect.search] Error searching tenants:", error);
    return apiError("Internal error searching tenants", "INTERNAL_ERROR", 500);
  }
}
