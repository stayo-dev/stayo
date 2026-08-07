export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

const REVIEW_STATUSES = ["PENDING", "VERIFIED", "REJECTED"];

/**
 * GET /api/platform-admin/owner-documents?status=PENDING
 *
 * The review queue. Owner KYC uploads have been landing in `owner_documents`
 * since ADR-038 with **no admin surface to review them** — owners were
 * uploading into a queue nobody could see, and nothing could ever leave
 * PENDING. This is that surface.
 *
 * Defaults to PENDING because that is the actionable list; the other statuses
 * are for looking up a past decision.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);

  try {
    if (!session || session.role !== "ADMIN") {
      return apiError("Admin access only", "FORBIDDEN", 403);
    }

    const requested = String(req.nextUrl.searchParams.get("status") || "PENDING").toUpperCase();
    if (!REVIEW_STATUSES.includes(requested)) {
      return apiError(`status must be one of ${REVIEW_STATUSES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const documents = await prisma.owner_documents.findMany({
      where: { status: requested, is_active: true },
      orderBy: { uploaded_at: "asc" }, // Oldest first — nobody should wait longest.
      take: 200,
      select: {
        id: true,
        doc_type: true,
        file_url: true,
        mime_type: true,
        status: true,
        uploaded_at: true,
        reviewed_at: true,
        review_note: true,
        profile: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    return apiResponse({ documents, status: requested });
  } catch (error: any) {
    console.error("Detailed API Error [platform-admin.owner-documents]:", error);
    return apiError("Could not load the document queue.", "INTERNAL_ERROR", 500);
  }
}
