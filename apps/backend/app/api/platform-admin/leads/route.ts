export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PlatformLeadStatus } from "@prisma/client";

const VALID_STATUSES: string[] = Object.values(PlatformLeadStatus);

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/leads?search=&status=
 * Prospective hostel-owner leads (distinct from the tenant-admissions
 * `leads` table — see docs/obsidian/Database.md).
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status") || undefined;

    const leads = await prisma.platform_leads.findMany({
      where: {
        ...(status ? { status: status as PlatformLeadStatus } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { hostel_name: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { created_at: "desc" },
      take: 200,
    });

    return apiResponse({ leads });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch leads");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * POST /api/platform-admin/leads
 * Body: { name, hostelName, phone, city?, bedCount?, notes? }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const { name, hostelName, phone, city, bedCount, notes } = body;

    if (!name?.trim()) return apiError("name is required", "VALIDATION_ERROR", 400);
    if (!hostelName?.trim()) return apiError("hostelName is required", "VALIDATION_ERROR", 400);
    if (!phone?.trim()) return apiError("phone is required", "VALIDATION_ERROR", 400);

    const lead = await prisma.platform_leads.create({
      data: {
        name: name.trim(),
        hostel_name: hostelName.trim(),
        phone: phone.trim(),
        city: city?.trim() || null,
        bed_count: bedCount ? Number(bedCount) : null,
        notes: notes?.trim() || null,
        tracking_token: crypto.randomBytes(32).toString("hex"),
      },
    });

    return apiResponse(lead, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create lead");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
