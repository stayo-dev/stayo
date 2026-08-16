export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/leads/[id]/notes
 *
 * The notes thread. `platform_leads.notes` (a single free-text field) still
 * exists and is untouched — but a thread is what survives one admin handing
 * a lead to another.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const notes = await prisma.platform_lead_notes.findMany({
      where: { lead_id: id },
      orderBy: { created_at: "desc" },
      take: 100,
    });

    // Author names, resolved in one query rather than a join per note.
    const authorIds = Array.from(
      new Set(notes.map((n: { author_id: string | null }) => n.author_id).filter(Boolean)),
    ) as string[];
    const authors = authorIds.length
      ? await prisma.profile.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(authors.map((a: { id: string; name: string }) => [a.id, a.name]));

    return apiResponse({
      notes: notes.map((n: any) => ({
        id: n.id,
        body: n.body,
        created_at: n.created_at,
        author_id: n.author_id,
        author_name: n.author_id ? (nameById.get(n.author_id) ?? "Removed admin") : "System",
      })),
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch notes");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/** POST /api/platform-admin/leads/[id]/notes — body: { body } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const payload = await req.json();
    const body = String(payload?.body || "").trim();
    if (!body) return apiError("A note cannot be empty", "VALIDATION_ERROR", 400);

    const lead = await prisma.platform_leads.findUnique({ where: { id }, select: { id: true } });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);

    const note = await prisma.platform_lead_notes.create({
      data: { lead_id: id, body: body.slice(0, 4000), author_id: session.sub ?? null },
    });
    return apiResponse({ note });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to add note");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
