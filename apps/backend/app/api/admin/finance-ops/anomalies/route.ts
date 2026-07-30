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
  const status = searchParams.get("status") || "OPEN";
  const severity = searchParams.get("severity") || undefined;
  const anomalyType = searchParams.get("type") || undefined;
  const hostelId = searchParams.get("hostelId") || undefined;
  const take = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 200);

  try {
    const anomalies = await (prisma as any).paymentOperationalAnomaly.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(anomalyType ? { anomaly_type: anomalyType } : {}),
        ...(hostelId ? { hostel_id: hostelId } : {}),
      },
      orderBy: [
        { severity: "asc" },
        { detected_at: "desc" },
      ],
      take,
    });

    return apiResponse({ anomalies });
  } catch (error: any) {
    console.error("[FINANCE_OPS_ANOMALIES]", error);
    return apiError(error?.message || "Failed to fetch payment anomalies");
  }
}
