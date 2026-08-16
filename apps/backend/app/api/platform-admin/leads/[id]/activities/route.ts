export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

const VALID_TYPES = ["CALL", "EMAIL", "WHATSAPP", "MEETING"];
const VALID_OUTCOMES = [
  "CONNECTED",
  "NO_ANSWER",
  "BUSY",
  "WRONG_NUMBER",
  "SENT",
  "REPLIED",
  "NO_REPLY",
];

/**
 * GET /api/platform-admin/leads/[id]/activities
 *
 * The human-authored outreach log for one lead — every call placed, every
 * email sent, and how it went. This is what lets the next call start from
 * what the last one learned instead of from nothing.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const activities = await prisma.platform_lead_activities.findMany({
      where: { lead_id: id },
      orderBy: { created_at: "desc" },
      take: 100,
    });
    return apiResponse({ activities });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch activities");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * POST /api/platform-admin/leads/[id]/activities
 * Body: { type, outcome, note? }
 *
 * Deliberately does NOT change the lead's status. Logging "no answer" three
 * times is not progress, and auto-advancing on the first connected call would
 * take the stage decision away from the admin who made the call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json();
    const type = String(body?.type || "").toUpperCase();
    const outcome = String(body?.outcome || "").toUpperCase();

    if (!VALID_TYPES.includes(type)) {
      return apiError(`type must be one of: ${VALID_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    if (!VALID_OUTCOMES.includes(outcome)) {
      return apiError(`outcome must be one of: ${VALID_OUTCOMES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const lead = await prisma.platform_leads.findUnique({ where: { id }, select: { id: true } });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);

    const activity = await prisma.platform_lead_activities.create({
      data: {
        lead_id: id,
        type,
        outcome,
        note: body?.note ? String(body.note).trim().slice(0, 2000) : null,
        actor_id: session.sub ?? null,
      },
    });

    return apiResponse({ activity });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to log activity");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
