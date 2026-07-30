export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { composeRecentActivity } from "@/lib/services/platform-admin-activity-service";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/notifications
 * Powers the Admin Console's notification bell — reuses the same
 * leads/hostels/paid-invoices activity composition the dashboard's Recent
 * Activity card uses (composeRecentActivity), just with a larger limit
 * suited to a dropdown panel rather than a compact preview widget. No
 * separate notifications table or read/unread state — this is a live
 * derived feed, same convention as the dashboard card.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const notifications = await composeRecentActivity(20);
    return apiResponse({ notifications });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch notifications");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
