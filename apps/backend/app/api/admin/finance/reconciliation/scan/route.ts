export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { apiResponse, apiError, getSession } from "@/lib/auth";
import { financialReconciliationService } from "@/lib/services/financial-reconciliation-service";
import { mapServiceError } from "@/lib/api/admin-error";
import { readJson } from "@/lib/api/admin-error";

/**
 * POST /api/admin/finance/reconciliation/scan
 *
 * Body: { limit?: number, persist?: boolean }
 *
 * Runs all 7 operational reconciliation detectors and returns the structured issue
 * report. By default the scan is read-only — `persist:true` opts into
 * writing the deduped issues into `financial_reconciliation_issues`
 * (the partial unique index on fingerprint handles dedupe).
 *
 * This route requires OWNER access.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Owner access required", "FORBIDDEN", 403);
  }

  const body = await readJson<{ limit?: number; persist?: boolean }>(req);
  const limit = body?.limit;
  const persist = body?.persist === true;

  try {
    const report = await financialReconciliationService.detectAll({ limit });
    const persistResult = persist
      ? await financialReconciliationService.persistIssues(report, { actorId: session.sub })
      : null;
    return apiResponse({
      report: {
        started_at: report.started_at,
        finished_at: report.finished_at,
        total_ms: report.total_ms,
        total_issues: report.issues.length,
        summary: report.summary,
        issues: report.issues,
      },
      persisted: persistResult,
    });
  } catch (err: any) {
    return mapServiceError(err);
  }
}
