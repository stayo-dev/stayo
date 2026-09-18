export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { prisma } from "@/lib/db";

/** PATCH /api/platform-admin/plans/[id] — body: { isActive?, priceAmount?, description? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_SUBSCRIPTIONS");
    const existing = await prisma.subscription_plans.findUnique({ where: { id } });
    if (!existing) return apiError("Plan not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const { isActive, priceAmount, description } = body;

    const updated = await prisma.subscription_plans.update({
      where: { id },
      data: {
        ...(isActive !== undefined ? { is_active: Boolean(isActive) } : {}),
        ...(priceAmount !== undefined ? { price_amount: Number(priceAmount) } : {}),
        ...(description !== undefined ? { description } : {}),
        updated_at: new Date(),
      },
    });
    return apiResponse(updated);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update plan");
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
