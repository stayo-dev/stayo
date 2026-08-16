export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";

const TICKET_CATEGORIES = ["APP_BUG", "ACCOUNT_ISSUE", "PAYMENT_ISSUE", "OTHER"];
const MAX_SUBJECT_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 4000;

/**
 * Tenant/user → Stayo Admin support tickets (ADR-079).
 *
 * Deliberately separate from the tenant → owner complaint system
 * (`tenant_service_requests`/`complaints`) — this is for reporting a problem
 * with the Stayo app or website itself, not a hostel. Available to any
 * signed-in profile regardless of role or tenancy; not gated on `hasLiveTenancy`.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  const tickets = await prisma.platform_support_tickets.findMany({
    where: { profile_id: session.sub },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      category: true,
      subject: true,
      description: true,
      status: true,
      created_at: true,
      resolved_at: true,
      admin_note: true,
    },
  });

  return apiResponse({ tickets });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const body = await req.json().catch(() => ({}));
    const category = String(body?.category || "").toUpperCase();
    const subject = String(body?.subject || "").trim();
    const description = String(body?.description || "").trim();

    if (!TICKET_CATEGORIES.includes(category)) {
      return apiError(`category must be one of ${TICKET_CATEGORIES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    if (!subject) return apiError("subject is required", "VALIDATION_ERROR", 400);
    if (subject.length > MAX_SUBJECT_LENGTH) {
      return apiError(`subject must be ${MAX_SUBJECT_LENGTH} characters or fewer`, "VALIDATION_ERROR", 400);
    }
    if (!description) return apiError("description is required", "VALIDATION_ERROR", 400);
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return apiError(`description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`, "VALIDATION_ERROR", 400);
    }

    const created = await prisma.platform_support_tickets.create({
      data: {
        profile_id: session.sub,
        category,
        subject,
        description,
        status: "OPEN",
      },
      select: {
        id: true,
        category: true,
        subject: true,
        description: true,
        status: true,
        created_at: true,
        resolved_at: true,
        admin_note: true,
      },
    });

    await eventLog.log("PLATFORM_SUPPORT_TICKET_CREATED", session.sub, {
      ticket_id: created.id,
      category,
    });

    return apiResponse({ ticket: created }, 201);
  } catch (error: any) {
    console.error("Detailed API Error [profile.support-tickets]:", error);
    return apiError("Could not submit your ticket. Please try again.", "INTERNAL_ERROR", 500);
  }
}
