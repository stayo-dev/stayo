export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { portfolioService } from "@/lib/services/portfolio-service";
import { expenseService } from "@/lib/services/expense-service";
import { ownerCollectionHistory } from "@/lib/services/owner-collection-history";

/**
 * GET /api/owner/portfolio/summary
 *
 * Returns the authenticated owner's portfolio summary: per-hostel cards
 * (from hostel_daily_snapshots) + owner-level aggregate (from portfolio cache).
 *
 * No hostelId parameter — this is the portfolio (owner) scope.
 * Operational data must never be fetched from this route.
 *
 * **Month spending and lifetime collection are composed here, not inside
 * `portfolioService`.** That service states its own invariant — every metric
 * comes from `hostel_daily_snapshots`, no raw transactional table is queried
 * in it — and `expenses` and `payments` are both raw transactional tables. The
 * automated check (`architectural-invariants-check.ts`) only names payments,
 * obligations and tenants, so putting the expense query there would have
 * passed the script while breaking the rule the script exists to protect.
 * Composing services in the route is the pattern CLAUDE.md already prescribes
 * for financial reads.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("include_archived") === "true";
    // In parallel: they share nothing, and Home waits on all three.
    const [summary, spend, everCollected] = await Promise.all([
      portfolioService.getPortfolioSummary(session.sub, includeArchived),
      // Never let a spending figure take down the whole dashboard — Home's
      // tenants, beds and collection numbers matter more than this card.
      expenseService.getMonthSpendSummary(session.sub).catch(() => null),
      // Same tolerance, opposite default. On failure this resolves `false`,
      // which at worst shows a finished owner a checklist step they have
      // already done — the alternative, defaulting true, would hide the
      // checklist from an owner who genuinely needs it, which is the exact
      // failure ADR-139 exists to remove.
      ownerCollectionHistory.hasEverCollected(session.sub).catch(() => false),
    ]);

    return apiResponse({ ...summary, month_spend: spend, has_ever_collected: everCollected });
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch portfolio summary");
  }
}
