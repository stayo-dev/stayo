export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * "Not now" on the overdue guardian wall (ADR-212).
 *
 * Counting the dismissals is what lets the wall *back off* — it reappears on
 * every third dashboard entry rather than every one. A tenant who has read it
 * twice knows what it says, and a prompt that cannot be escaped stops being
 * read at all. The count only ever goes up, and it never blocks anything.
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

    await prisma.tenants.update({
      where: { id: tenant.id },
      data: { guardian_verification_prompt_count: { increment: 1 } },
    });

    return apiResponse({ dismissed: true });
  } catch (error: any) {
    return apiError(error?.message || "Failed to record the dismissal", "ERROR", 500);
  }
}
