export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { frontendUrl } from "@/lib/config/domains";
import { renderStayPosterPdf } from "@/lib/pdf/stay-poster-pdf-lib";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

/**
 * GET /api/hostels/[id]/stay/poster — the A4 QR poster for the entrance.
 * Bytes, not a stored file: it encodes /stay/<hostelId>, which never changes.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const hostel = await prisma.hostels.findUnique({ where: { id }, select: { name: true } });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const bytes = await renderStayPosterPdf({ hostelName: hostel.name, url: frontendUrl(`/stay/${id}`) });
    const safeName = String(hostel.name || "hostel").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}-stay-qr.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
