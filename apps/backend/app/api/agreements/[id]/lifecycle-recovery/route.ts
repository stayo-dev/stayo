export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import {
  AgreementLifecycleRecoveryError,
  agreementLifecycleRecoveryService,
} from "@/src/services/tenants/agreement-lifecycle-recovery-service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const agreement = await prisma.agreement.findUnique({
      where: { id: params.id },
      include: { hostel: { select: { owner_id: true } } },
    });

    if (!agreement) return apiError("Agreement not found", "AGREEMENT_NOT_FOUND", 404);
    if (session.role === "OWNER" && agreement.hostel.owner_id !== (session.owner_id || session.sub)) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const result = await agreementLifecycleRecoveryService.recoverAgreementLifecycle(params.id, {
      agreement_start_date: body.agreement_start_date,
      agreement_end_date: body.agreement_end_date,
      agreement_duration_months: body.agreement_duration_months,
    });
    return apiResponse(result);
  } catch (error: any) {
    if (error instanceof AgreementLifecycleRecoveryError || error?.name === "AgreementLifecycleRecoveryError") {
      return apiError(error.message, error.code, error.status || 400, error.details);
    }
    return apiError(error.message || "Failed to recover agreement lifecycle data");
  }
}
