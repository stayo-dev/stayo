export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { apiResponse, apiError, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const ALLOWED_STATUS = new Set(["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"]);
const ALLOWED_SEVERITY = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/**
 * GET /api/admin/finance/reconciliation/issues
 *   ?status=OPEN|INVESTIGATING|RESOLVED|IGNORED   (default: OPEN)
 *   &severity=LOW|MEDIUM|HIGH|CRITICAL            (optional)
 *   &issueType=...                                (optional)
 *   &ownerId=...                                  (optional)
 *   &hostelId=...                                 (optional)
 *   &limit=100                                    (1..500)
 *
 * Lists persisted reconciliation issues. Sorted by severity (CRITICAL
 * first) then detected_at DESC so the loudest fires float to the top.
 * Owner-accessible.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Owner access required", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "OPEN";
  const severity = searchParams.get("severity");
  const issueType = searchParams.get("issueType");
  const ownerId = searchParams.get("ownerId");
  const hostelId = searchParams.get("hostelId");
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 500);

  if (!ALLOWED_STATUS.has(status)) return apiError("Invalid status", "BAD_REQUEST", 400);
  if (severity && !ALLOWED_SEVERITY.has(severity)) return apiError("Invalid severity", "BAD_REQUEST", 400);

  const where: Record<string, any> = { status };
  if (severity) where.severity = severity;
  if (issueType) where.issue_type = issueType;
  if (ownerId) where.owner_id = ownerId;
  if (hostelId) where.hostel_id = hostelId;

  const issues = await prisma.financial_reconciliation_issues.findMany({
    where,
    orderBy: [{ detected_at: "desc" }],
    take: limit,
  });

  // Manual severity sort to avoid relying on string ordering: CRITICAL > HIGH > MEDIUM > LOW.
  const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  issues.sort((a: any, b: any) => {
    const r = (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9);
    if (r !== 0) return r;
    return b.detected_at.getTime() - a.detected_at.getTime();
  });

  return apiResponse({ issues, count: issues.length });
}
