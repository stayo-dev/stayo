export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 🖊️ THE OWNER'S EXISTING SIGNATURE
 * GET — the most recent signature this owner has already captured, if any.
 *
 * `owner_signature_url` lives on `AgreementTemplate`, which is per hostel — so
 * an owner running three hostels was asked to draw the same signature three
 * times, once per builder run. It is the same person signing the same way; the
 * only thing the repeat asked for was patience.
 *
 * This returns the latest one so the builder can offer to reuse it. It is an
 * *offer*, never automatic: the owner still confirms, and can draw a new one.
 * Scoped to templates on hostels this owner owns, so one owner's signature can
 * never be offered to another.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const template = await prisma.agreementTemplate.findFirst({
      where: {
        owner_signature_url: { not: null },
        hostel: { owner_id: session.sub, status: { in: ["ACTIVE", "INACTIVE"] } },
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        owner_signature_url: true,
        owner_name: true,
        hostel: { select: { id: true, name: true } },
      },
    });

    if (!template?.owner_signature_url) {
      return apiResponse({ signature: null });
    }

    return apiResponse({
      signature: {
        url: template.owner_signature_url,
        owner_name: template.owner_name,
        // Named so the offer can say where it came from — "the signature you
        // used for Sri Adithya" is checkable; an unattributed image is not.
        from_hostel_id: template.hostel?.id ?? null,
        from_hostel_name: template.hostel?.name ?? null,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[owner.signature.GET]", msg);
    return apiError(msg || "Failed to load your signature");
  }
}
