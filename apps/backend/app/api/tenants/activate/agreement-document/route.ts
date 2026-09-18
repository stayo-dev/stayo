export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activationSubjectFromRequest } from "@/src/services/tenants/activation-request-subject";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { mapActivationError } from "@/src/services/tenants/activation-error";
import { AgreementGenerationService } from "@/src/services/tenants/agreement-generation-service";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";
import { buildAgreementDocument } from "@/src/services/agreements/agreement-document";

/**
 * The document a tenant reads before signing.
 *
 * Token-authenticated, not session-authenticated: onboarding happens before the
 * tenant has an account, so this cannot sit behind `getSession`. Its peers
 * `/activate/photo` and `/activate/documents` resolve the same way.
 *
 * It composes from the agreement's own snapshot, so what is read here is what
 * the PDF will be generated from — the two share a `contentHash`. Before this
 * existed the tenant was shown a hardcoded document containing none of the
 * owner's clauses, and the real one was generated only *after* signing.
 */

/**
 * Duplicated from the documents route rather than shared, matching how
 * `/activate/photo` and `/activate/documents` already each carry their own
 * copy. If a third caller appears, extract it then.
 */
async function resolveTenant(req: NextRequest, token: string | null) {
  const subject = await activationSubjectFromRequest(req, token);
  if (!subject.ok) {
    return { tenant: null, error: apiError(subject.message, subject.code, 400) };
  }

  const resolved = subject.mode === "session"
    ? await tenantInvitationLifecycleService.resolveForSession(String(subject.tenantId || ""))
    : await tenantInvitationLifecycleService.resolveByToken(String(subject.token || ""));

  if (!resolved.tenant) {
    return { tenant: null, error: apiError("Invalid or expired activation link", "INVALID", 410) };
  }

  return { tenant: resolved.tenant, error: null };
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    const { tenant, error } = await resolveTenant(req, token);
    if (error) return error;

    // Scoped to the resolved tenant, never a bare id from the caller — the
    // agreement is reachable only through proof of who is asking.
    const agreement = await prisma.agreement.findFirst({
      where: { tenant_id: tenant!.id },
      orderBy: { generated_at: "desc" },
      include: { template: { select: { version_number: true } } },
    });
    if (!agreement) return apiError("No agreement found", "NOT_FOUND", 404);

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
    // The activation services signal failure by throwing "CODE: message",
    // so an expired link must become a 410 rather than a 500 that tells the
    // tenant nothing.
    const mapped = mapActivationError(error, "Failed to load agreement document");
    return apiError(mapped.message, mapped.code, mapped.status);
  }
}
