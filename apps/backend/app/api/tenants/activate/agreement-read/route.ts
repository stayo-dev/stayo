export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activationSubjectFromRequest } from "@/src/services/tenants/activation-request-subject";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { mapActivationError } from "@/src/services/tenants/activation-error";

/**
 * Evidence that the tenant read the agreement before signing it.
 *
 * Recorded server-side rather than in component state for two reasons: a reload
 * must not hand out a free pass, and the evidence has to outlive the session
 * that produced it. The signing gate reads `document_read_completed_at` back
 * from the agreement, not from anything the client remembers.
 *
 * See ADR-217.
 */

const STAGES = ["opened", "completed"] as const;
type Stage = (typeof STAGES)[number];

const HASH_PATTERN = /^[0-9a-f]{64}$/;

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const stage = String(body?.stage || "") as Stage;
    const contentHash = String(body?.content_hash || "");

    // Validated before anything is resolved or written: a malformed call must
    // never leave a half-stamped read behind.
    if (!STAGES.includes(stage)) {
      return apiError("stage must be 'opened' or 'completed'", "VALIDATION_ERROR", 400);
    }
    if (!HASH_PATTERN.test(contentHash)) {
      return apiError("content_hash must be a 64-character hex digest", "VALIDATION_ERROR", 400);
    }

    const { tenant, error } = await resolveTenant(req, body?.token ?? null);
    if (error) return error;

    const agreement = await prisma.agreement.findFirst({
      where: { tenant_id: tenant!.id },
      orderBy: { generated_at: "desc" },
      select: { id: true, document_opened_at: true, document_read_completed_at: true },
    });
    if (!agreement) return apiError("No agreement found", "NOT_FOUND", 404);

    const now = new Date();
    // `??` rather than assignment: the *first* open is the evidence, so
    // re-reading the document must not quietly reset it to a later time.
    const openedAt = agreement.document_opened_at ?? now;

    const data = stage === "opened"
      ? { document_opened_at: openedAt }
      : {
          document_opened_at: openedAt,
          document_read_completed_at: now,
          document_content_hash: contentHash,
        };

    const updated = await prisma.agreement.update({ where: { id: agreement.id }, data });

    return apiResponse({
      opened_at: updated.document_opened_at,
      read_completed_at: updated.document_read_completed_at ?? null,
    });
  } catch (error: any) {
    // The activation services signal failure by throwing "CODE: message",
    // so an expired link must become a 410 rather than a 500 that tells the
    // tenant nothing.
    const mapped = mapActivationError(error, "Failed to record agreement read");
    return apiError(mapped.message, mapped.code, mapped.status);
  }
}
