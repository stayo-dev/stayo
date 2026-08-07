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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/platform-admin/leads?search=&status=&limit=&offset=
 *
 * Prospective hostel-owner leads (distinct from the tenant-admissions
 * `leads` table — see docs/obsidian/Database.md).
 *
 * Paginated, and returns `total` plus a per-status breakdown. Previously this
 * was a bare `take: 200` with no total and no next page: at ~100 leads a day
 * that silently truncated after two days, with nothing on screen to say so.
 * The counts also let the filter chips show the shape of the backlog without
 * one request per status.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status") || undefined;
    if (status && !VALID_STATUSES.includes(status)) {
      return apiError(`status must be one of ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

    // Search applies to the counts too, otherwise the chips would advertise
    // statuses that the current search has no results for.
    const searchWhere = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { hostel_name: { contains: search, mode: "insensitive" as const } },
            { city: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search } },
          ],
        }
      : {};

    const where = {
      ...(status ? { status: status as PlatformLeadStatus } : {}),
      ...searchWhere,
    };

    const [leads, total, grouped] = await Promise.all([
      prisma.platform_leads.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.platform_leads.count({ where }),
      prisma.platform_leads.groupBy({
        by: ["status"],
        where: searchWhere,
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const value of VALID_STATUSES) counts[value] = 0;
    let all = 0;
    for (const row of grouped as Array<{ status: string; _count: { _all: number } }>) {
      counts[row.status] = row._count._all;
      all += row._count._all;
    }

    return apiResponse({
      leads,
      total,
      limit,
      offset,
      has_more: offset + leads.length < total,
      counts: { ALL: all, ...counts },
    });
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
