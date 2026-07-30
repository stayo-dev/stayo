export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);
  try {
    const body = await req.json();
    const data: Record<string, any> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (Object.keys(data).length === 0) return apiError("No valid profile fields to update", "VALIDATION_ERROR", 400);
    const profile = await prisma.profile.update({
      where: { id: session.sub },
      data,
      select: { id: true, name: true, phone: true, email: true, role: true },
    });
    return apiResponse({ profile });
  } catch (error: any) {
    return apiError(error?.message || "Failed to update profile", "ERROR", 500);
  }
}
