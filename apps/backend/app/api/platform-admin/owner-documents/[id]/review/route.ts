export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import {
  canReviewDocument,
  isReviewDecision,
  validateReview,
} from "@/src/services/owner-documents/document-review-guards";

/**
 * POST /api/platform-admin/owner-documents/[id]/review
 * Body: { decision: "VERIFIED" | "REJECTED", note?: string }
 *
 * The only thing that can move an owner KYC document out of PENDING — the
 * uploader never can (ADR-038), which is what makes "verified" mean anything.
 *
 * A rejection must carry a reason: the owner is shown it, and a rejection
 * without one just makes them upload the same file again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;

  try {
    if (!session || session.role !== "ADMIN") {
      return apiError("Admin access only", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({}));
    const decisionRaw = String(body?.decision || "").toUpperCase();
    if (!isReviewDecision(decisionRaw)) {
      return apiError("decision must be VERIFIED or REJECTED", "VALIDATION_ERROR", 400);
    }
    const decision = decisionRaw as "VERIFIED" | "REJECTED";
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    const noteCheck = validateReview(decision, note);
    if (!noteCheck.ok) return apiError(noteCheck.reason, "VALIDATION_ERROR", 400);

    const document = await prisma.owner_documents.findUnique({
      where: { id },
      select: { id: true, status: true, doc_type: true, profile_id: true },
    });
    if (!document) return apiError("Document not found", "NOT_FOUND", 404);

    const guard = canReviewDocument(document.status);
    if (!guard.ok) return apiError(guard.reason, "INVALID_TRANSITION", 400);

    const updated = await prisma.owner_documents.update({
      where: { id },
      data: {
        status: decision,
        reviewed_at: new Date(),
        reviewed_by: session.sub,
        review_note: note || null,
      },
      select: {
        id: true,
        doc_type: true,
        status: true,
        reviewed_at: true,
        review_note: true,
      },
    });

    await eventLog.log(
      decision === "VERIFIED" ? "OWNER_DOCUMENT_VERIFIED" : "OWNER_DOCUMENT_REJECTED",
      document.profile_id,
      { document_id: id, doc_type: document.doc_type, reviewed_by: session.sub },
    );

    return apiResponse(updated);
  } catch (error: any) {
    console.error("Detailed API Error [platform-admin.owner-documents.review]:", error);
    return apiError("Could not record that review.", "INTERNAL_ERROR", 500);
  }
}
