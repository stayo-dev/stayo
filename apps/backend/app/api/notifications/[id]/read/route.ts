import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { notificationService } from "@/lib/services/notification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * 🔔 Mark Notification as Read
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const notification = await notificationService.markAsRead(params.id, session.sub);
    return apiResponse(notification);
  } catch (error: any) {
    return apiError(error.message || "Failed to mark notification as read");
  }
}
