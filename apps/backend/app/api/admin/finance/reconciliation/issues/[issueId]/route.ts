export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { apiResponse, apiError, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readJson } from "@/lib/api/admin-error";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["INVESTIGATING", "RESOLVED", "IGNORED"],
  INVESTIGATING: ["RESOLVED", "IGNORED", "OPEN"],
  RESOLVED: [],
  IGNORED: [],
};

/**
 * PATCH /api/admin/finance/reconciliation/issues/[issueId]
 * Body: { status: "INVESTIGATING"|"RESOLVED"|"IGNORED"|"OPEN", notes?: string }
 *
 * Transitions an issue's status. Resolution and acknowledgement are the
 * only mutations allowed against a persisted issue row — the diagnostic
 * payload (description, metadata, fingerprint, scope) is immutable so
 * historical audit trails remain trustworthy.
 *
 * Terminal states (RESOLVED / IGNORED) are sticky: re-opening must come
 * from a new detection run, which dedups by fingerprint via the partial
 * unique index `udx_fri_fingerprint_open`.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ issueId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Owner access required", "FORBIDDEN", 403);
  }

  const { issueId } = await params;
  const body = await readJson<{ status?: string; notes?: string }>(req);
  if (!body?.status) return apiError("status required", "BAD_REQUEST", 400);

  const existing = await prisma.financial_reconciliation_issues.findUnique({
    where: { id: issueId },
  });
  if (!existing) return apiError("Issue not found", "NOT_FOUND", 404);

  const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(body.status)) {
    return apiError(
      `Cannot transition ${existing.status} → ${body.status}`,
      "INVALID_TRANSITION",
      409,
    );
  }

  const now = new Date();
  const patch: Record<string, any> = { status: body.status };
  if (body.status === "INVESTIGATING") {
    patch.acknowledged_at = now;
    patch.acknowledged_by = session.sub;
  } else if (body.status === "RESOLVED" || body.status === "IGNORED") {
    patch.resolved_at = now;
    patch.resolved_by = session.sub;
    if (body.notes) patch.resolution_notes = body.notes;
  }

  const updated = await prisma.financial_reconciliation_issues.update({
    where: { id: issueId },
    data: patch,
  });
  return apiResponse({ issue: updated });
}
