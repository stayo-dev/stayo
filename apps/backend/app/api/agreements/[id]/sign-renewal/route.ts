export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import {
  AgreementRenewalSigningError,
  agreementRenewalSigningService,
} from "@/src/services/tenants/agreement-renewal-signing-service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
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

    const body = await req.json().catch(() => ({}));
    const result = await agreementRenewalSigningService.signRenewalAgreement({
      renewalAgreementId: params.id,
      tenantSignature: {
        signature_url: body?.tenant_signature_url || body?.tenantSignature?.signature_url,
        signature_name: body?.tenant_signature_name || body?.tenantSignature?.signature_name,
      },
      guardianSignature: body?.guardianSignature || {
        signature_url: body?.guardian_signature_url,
        signature_name: body?.guardian_signature_name,
        relation: body?.guardian_relation,
      },
      signedBy: session.role,
      metadata: {
        ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
        userAgent: req.headers.get("user-agent"),
      },
    });

    return apiResponse(result);
  } catch (error: any) {
    if (error instanceof AgreementRenewalSigningError || error?.name === "AgreementRenewalSigningError") {
      return apiError(error.message, error.code, error.status || 409, error.details);
    }
    return apiError(error.message || "Failed to sign renewal agreement");
  }
}
