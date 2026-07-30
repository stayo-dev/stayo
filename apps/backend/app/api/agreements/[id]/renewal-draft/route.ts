export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { AgreementRenewalError, agreementRenewalService } from "@/src/services/tenants/agreement-renewal-service";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(_req);
  if (!session || !["OWNER", "ADMIN", "TENANT"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const agreement = await prisma.agreement.findUnique({
      where: { id: params.id },
      include: { tenant: { select: { profile_id: true, owner_id: true } }, hostel: { select: { owner_id: true } } },
    });

    if (!agreement) return apiError("Agreement not found", "AGREEMENT_NOT_FOUND", 404);
    if (session.role === "OWNER" && agreement.hostel.owner_id !== (session.owner_id || session.sub)) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }
    if (session.role === "TENANT" && agreement.tenant.profile_id !== session.sub) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }

    let body: any = {};
    try {
      body = await _req.json();
    } catch {
      body = {};
    }

    const result = await agreementRenewalService.createRenewalDraft(params.id, {
      agreement_start_date: body.agreement_start_date,
      agreement_end_date: body.agreement_end_date,
      agreement_duration_months: body.agreement_duration_months,
    });
    return apiResponse(result, 201);
  } catch (error: any) {
    if (error instanceof AgreementRenewalError || error?.name === "AgreementRenewalError") {
      return apiError(error.message, error.code, error.status || 409, error.details);
    }
    return apiError(error.message || "Failed to create renewal draft");
  }
}
