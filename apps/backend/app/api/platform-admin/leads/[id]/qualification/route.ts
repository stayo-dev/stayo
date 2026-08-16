export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/** Blank string means "clear this field"; absent means "leave it alone". */
function optionalInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("VALIDATION: expected a non-negative number");
  return Math.round(n);
}

function optionalDecimal(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("VALIDATION: expected a non-negative number");
  return n;
}

function optionalText(value: unknown, max = 4000): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * PATCH /api/platform-admin/leads/[id]/qualification
 *
 * The answers an admin fills in while on the call — hostel size, current
 * tooling, and the three discovery questions ("what's broken", "why Stayo",
 * "what they expect").
 *
 * Every field is optional and independently clearable, because this is filled
 * in progressively across several conversations rather than submitted once.
 * An absent key leaves the stored value alone; an empty string clears it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json();

    const data: Record<string, unknown> = {
      qual_beds: optionalInt(body?.qual_beds),
      qual_rooms: optionalInt(body?.qual_rooms),
      qual_occupancy_pct: optionalInt(body?.qual_occupancy_pct),
      qual_monthly_revenue: optionalDecimal(body?.qual_monthly_revenue),
      estimated_value: optionalDecimal(body?.estimated_value),
      qual_branches: optionalText(body?.qual_branches, 200),
      current_tooling: optionalText(body?.current_tooling, 200),
      pain_point: optionalText(body?.pain_point),
      discovery_problem: optionalText(body?.discovery_problem),
      discovery_why: optionalText(body?.discovery_why),
      discovery_expect: optionalText(body?.discovery_expect),
    };

    for (const key of Object.keys(data)) {
      if (data[key] === undefined) delete data[key];
    }
    if (Object.keys(data).length === 0) {
      return apiError("No qualification fields supplied", "VALIDATION_ERROR", 400);
    }

    const occupancy = data.qual_occupancy_pct as number | null | undefined;
    if (typeof occupancy === "number" && occupancy > 100) {
      return apiError("Occupancy cannot exceed 100%", "VALIDATION_ERROR", 400);
    }

    const existing = await prisma.platform_leads.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return apiError("Lead not found", "NOT_FOUND", 404);

    const lead = await prisma.platform_leads.update({
      where: { id },
      data: { ...data, updated_at: new Date() },
    });

    return apiResponse({ lead });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to save qualification");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    return apiError(msg);
  }
}
