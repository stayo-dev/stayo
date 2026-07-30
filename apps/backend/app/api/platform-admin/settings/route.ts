export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

const SETTINGS_KEY = "general";

/** GET /api/platform-admin/settings */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const row = await prisma.platform_settings.findUnique({ where: { key: SETTINGS_KEY } });
    return apiResponse({ settings: row?.value ?? { supportEmail: "", supportPhone: "", businessAddress: "" } });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch settings");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/** PATCH /api/platform-admin/settings — body: { supportEmail?, supportPhone?, businessAddress? } */
export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const existing = await prisma.platform_settings.findUnique({ where: { key: SETTINGS_KEY } });
    const merged = { ...(existing?.value as object ?? {}), ...body };

    const row = await prisma.platform_settings.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: merged, updated_at: new Date() },
      update: { value: merged, updated_at: new Date() },
    });
    return apiResponse({ settings: row.value });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update settings");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
