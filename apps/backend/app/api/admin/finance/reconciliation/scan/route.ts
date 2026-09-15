export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { apiResponse, getSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/security/authz";
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
 * Platform-admin only (C2, 2026-09-14 audit): a platform-wide scan and a write
 * into `financial_reconciliation_issues`, previously reachable by any owner.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const body = await readJson<{ limit?: number; persist?: boolean }>(req);
  const limit = body?.limit;
  const persist = body?.persist === true;

  try {
    const report = await financialReconciliationService.detectAll({ limit });
    const persistResult = persist
      ? await financialReconciliationService.persistIssues(report, { actorId: session!.sub })
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
