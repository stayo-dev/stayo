import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { notificationService } from "@/lib/services/notification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * 🔔 Get User Notifications
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const notifications = await notificationService.getUserNotifications(session.sub);
    return apiResponse(notifications);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch notifications");
  }
}
