export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/** GET /api/platform-admin/plans — the subscription plan catalog. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const plans = await prisma.subscription_plans.findMany({ orderBy: { price_amount: "asc" } });
    return apiResponse({ plans });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch plans");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/** POST /api/platform-admin/plans — body: { name, priceAmount, billingCycle, description? } */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const { name, priceAmount, billingCycle, description } = body;
    if (!name?.trim()) return apiError("name is required", "VALIDATION_ERROR", 400);
    if (!priceAmount || Number(priceAmount) <= 0) return apiError("priceAmount must be positive", "VALIDATION_ERROR", 400);
    if (!["MONTHLY", "YEARLY"].includes(billingCycle)) return apiError("billingCycle must be MONTHLY or YEARLY", "VALIDATION_ERROR", 400);

    const plan = await prisma.subscription_plans.create({
      data: { name: name.trim(), price_amount: Number(priceAmount), billing_cycle: billingCycle, description: description?.trim() || null },
    });
    return apiResponse(plan, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create plan");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
