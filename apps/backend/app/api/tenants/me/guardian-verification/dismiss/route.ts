export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nextPromptAfterDismissal } from "@/src/services/tenants/guardian-verification";

/**
 * "Not now" on the overdue guardian wall (ADR-212).
 *
 * Pushes the next prompt out by `GUARDIAN_SNOOZE_DAYS` — which is what makes
 * the wall back off. A tenant who has read it twice knows what it says, and a
 * prompt that cannot be escaped stops being read at all.
 *
 * The count is incremented alongside, for reporting, but deliberately does not
 * gate anything: an earlier version gated the wall on `promptCount % 3`, which
 * deadlocked because the count only advances when the wall is dismissed, and a
 * dismissal requires the wall to have been shown. It appeared exactly once per
 * tenancy. The back-off has to live in something that moves on its own — a
 * date does, a dismissal counter does not.
 *
 * Never blocks anything either way.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: {
        OR: [{ profile_id: session.sub }, ...(session.tenant_id ? [{ id: session.tenant_id }] : [])],
      },
      select: { id: true },
    });
    if (!tenant) return apiError("Tenant not found", "TENANT_NOT_FOUND", 404);

    const nextPromptAt = nextPromptAfterDismissal(new Date());
    await prisma.tenants.update({
      where: { id: tenant.id },
      data: {
        guardian_verification_next_prompt_at: nextPromptAt,
        guardian_verification_prompt_count: { increment: 1 },
      },
    });

    return apiResponse({ dismissed: true, next_prompt_at: nextPromptAt });
  } catch (error: any) {
    return apiError(error?.message || "Failed to record the dismissal", "ERROR", 500);
  }
}
