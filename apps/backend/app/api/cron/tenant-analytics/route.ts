import { NextRequest, NextResponse } from "next/server";
import { tenantAnalyticsService } from "@/lib/services/tenant-analytics-service";
import { getLogger } from "@/lib/logger";

const logger = getLogger("cron.tenant-analytics");

/**
 * DORMANT: Analytics repair endpoint only.
 *
 * Do not schedule this route until tenant score recalculation is owned by an
 * event-driven update path or an action intelligence engine. Payment paths and
 * tenant score reads already perform targeted self-healing recalculations.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logger.info("Starting background job: recalculateAllTenantScores");
    const result = await tenantAnalyticsService.recalculateAllTenantScores();
    logger.info("Finished background job: recalculateAllTenantScores", result);
    return NextResponse.json(result);
  } catch (error: any) {
    logger.error("Cron tenant analytics failed", { err: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
