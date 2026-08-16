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
    if (body.phone !== undefined) {
      // Changing the phone must re-arm verification — otherwise a stale
      // `phone_verified: true` from a *previous* number would silently
      // apply to a new, never-verified one (the enquiry flow gates on this
      // flag to decide whether to ask for an OTP).
      const current = await prisma.profile.findUnique({ where: { id: session.sub }, select: { phone: true } });
      if (current?.phone !== body.phone) {
        data.phone = body.phone;
        data.phone_verified = false;
        data.mobile_verified = false;
      }
    }
    if (Object.keys(data).length === 0) return apiError("No valid profile fields to update", "VALIDATION_ERROR", 400);
    const profile = await prisma.profile.update({
      where: { id: session.sub },
      data,
      select: { id: true, name: true, phone: true, phone_verified: true, email: true, role: true },
    });
    return apiResponse({ profile });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return apiError("This phone number is already registered to another account.", "PHONE_TAKEN", 409);
    }
    return apiError(error?.message || "Failed to update profile", "ERROR", 500);
  }
}
