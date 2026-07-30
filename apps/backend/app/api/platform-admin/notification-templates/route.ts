export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotificationTemplateChannel } from "@prisma/client";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/** GET /api/platform-admin/notification-templates */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const templates = await prisma.notification_templates.findMany({ orderBy: { created_at: "asc" } });
    return apiResponse({ templates });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch templates");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/** POST /api/platform-admin/notification-templates — body: { name, channel, body } */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const { name, channel, body: text } = body;
    if (!name?.trim()) return apiError("name is required", "VALIDATION_ERROR", 400);
    if (!["WHATSAPP", "EMAIL"].includes(channel)) return apiError("channel must be WHATSAPP or EMAIL", "VALIDATION_ERROR", 400);
    if (!text?.trim()) return apiError("body is required", "VALIDATION_ERROR", 400);

    const template = await prisma.notification_templates.create({
      data: { name: name.trim(), channel: channel as NotificationTemplateChannel, body: text.trim() },
    });
    return apiResponse(template, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create template");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
