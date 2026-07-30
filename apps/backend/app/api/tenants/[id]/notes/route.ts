export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * GET /api/tenants/[id]/notes
 * Fetch all owner-private notes for a specific tenant.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id: tenantId } = await params;

  try {
    const scope = resolveOwnerScope(session);

    // Verify tenant belongs to owner
    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: scope.owner_id },
      select: { id: true },
    });

    if (!tenant) {
      return apiError("Tenant not found", "NOT_FOUND", 404);
    }

    const notes = await prisma.tenant_notes.findMany({
      where: { tenant_id: tenantId, owner_id: scope.owner_id },
      orderBy: { created_at: "desc" },
    });

    return apiResponse({ notes });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch tenant notes");
  }
}

/**
 * POST /api/tenants/[id]/notes
 * Create an owner-private note.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id: tenantId } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json();
    const { content } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return apiError("Content is required", "VALIDATION", 400);
    }

    // Verify tenant belongs to owner
    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: scope.owner_id },
      select: { id: true },
    });

    if (!tenant) {
      return apiError("Tenant not found", "NOT_FOUND", 404);
    }

    const note = await prisma.tenant_notes.create({
      data: {
        tenant_id: tenantId,
        owner_id: scope.owner_id,
        content: content.trim(),
      },
    });

    return apiResponse(note);
  } catch (error: any) {
    return apiError(error?.message || "Failed to create tenant note");
  }
}

/**
 * DELETE /api/tenants/[id]/notes
 * Delete an owner-private note.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id: tenantId } = await params;
  const { searchParams } = new URL(req.url);
  const noteId = searchParams.get("noteId");

  if (!noteId) {
    return apiError("Note ID is required", "VALIDATION", 400);
  }

  try {
    const scope = resolveOwnerScope(session);

    // Verify note belongs to owner and is associated with this tenant
    const note = await prisma.tenant_notes.findFirst({
      where: { id: noteId, tenant_id: tenantId, owner_id: scope.owner_id },
      select: { id: true },
    });

    if (!note) {
      return apiError("Note not found or access denied", "NOT_FOUND", 404);
    }

    await prisma.tenant_notes.delete({
      where: { id: noteId },
    });

    return apiResponse({ success: true });
  } catch (error: any) {
    return apiError(error?.message || "Failed to delete tenant note");
  }
}
