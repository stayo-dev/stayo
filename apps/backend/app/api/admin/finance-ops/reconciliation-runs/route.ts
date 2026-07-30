export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access required", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const paymentDomain = searchParams.get("paymentDomain") || undefined;
  const hostelId = searchParams.get("hostelId") || undefined;
  const take = Math.min(Math.max(Number(searchParams.get("limit") || 50), 1), 200);

  try {
    const runs = await (prisma as any).paymentReconciliationRun.findMany({
      where: {
        ...(paymentDomain ? { payment_domain: paymentDomain } : {}),
        ...(hostelId ? { hostel_id: hostelId } : {}),
      },
      orderBy: { started_at: "desc" },
      take,
    });

    return apiResponse({ runs });
  } catch (error: any) {
    console.error("[FINANCE_OPS_RECONCILIATION_RUNS]", error);
    return apiError(error?.message || "Failed to fetch reconciliation runs");
  }
}
