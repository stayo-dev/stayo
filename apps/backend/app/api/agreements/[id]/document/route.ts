export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AgreementGenerationService } from "@/src/services/tenants/agreement-generation-service";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";
import { buildAgreementDocument } from "@/src/services/agreements/agreement-document";

/**
 * The composed agreement, for someone who is logged in — a tenant re-reading
 * what they signed, or the owner looking at what they issued.
 *
 * The onboarding peer at `/api/tenants/activate/agreement-document` resolves a
 * tenant from a token and looks the agreement up *from* that tenant. This one
 * takes an id straight from the URL, so authorisation is the whole job: the
 * agreement is loaded first and then matched against the caller, and a caller
 * who matches neither party is told nothing about it.
 *
 * The document always renders from the agreement's own snapshot, never from the
 * hostel's current template — an owner publishing a new version must not change
 * what an already-signed agreement says.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session) return apiError("Forbidden", "FORBIDDEN", 403);

    const agreement = await prisma.agreement.findUnique({
      where: { id: params.id },
      include: {
        tenant: { select: { profile_id: true } },
        hostel: { select: { owner_id: true } },
        template: { select: { version_number: true } },
      },
    });
    if (!agreement) return apiError("Agreement not found", "NOT_FOUND", 404);

    // Explicit, and never a "first hostel" fallback — that is the exact class
    // of bug `check:invariants` exists to catch.
    const subject = String(session.sub || "");
    const ownerId = agreement.hostel?.owner_id ?? null;
    const tenantProfileId = agreement.tenant?.profile_id ?? null;

    // `tenants.profile_id` is nullable, so both sides are compared only when
    // the stored value actually exists: a null must never match a caller.
    const isOwner = Boolean(ownerId) && ownerId === subject;
    const isSignatory = Boolean(tenantProfileId) && tenantProfileId === subject;

    if (!isOwner && !isSignatory) return apiError("Forbidden", "FORBIDDEN", 403);

    const data = await AgreementGenerationService.getAgreementRenderData(agreement.id);
    const document = buildAgreementDocument(
      agreementDocumentInputFromRenderData(data, {
        reference: agreement.id,
        versionNumber: agreement.template?.version_number ?? 1,
        status: agreement.status,
        verificationUrl: null,
      }),
    );

    return apiResponse({ document });
  } catch (error: any) {
    return apiError(error?.message || "Failed to load agreement document", "INTERNAL_ERROR", 500);
  }
}
