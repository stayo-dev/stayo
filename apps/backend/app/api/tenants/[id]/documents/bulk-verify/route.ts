export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { eventLog } from "@/lib/services/event-log-service";
import crypto from "crypto";
import {
  approveRequiredActiveKycDocs,
  recomputeDocumentVerified,
  kycGapMessage,
} from "@/src/services/tenants/kyc-status";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const tenant = await prisma.tenants.findUnique({
      where: { id: params.id },
      select: { id: true, owner_id: true, profile_id: true, profile_type: true },
    });

    if (!tenant) {
      return NextResponse.json({ error: { message: "Tenant not found" } }, { status: 404 });
    }
    if (session.role === "OWNER" && tenant.owner_id !== session.sub) {
      return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const { approved, gap, documentIds } = await approveRequiredActiveKycDocs(tx, tenant, session.sub);
      if (gap.missing.length > 0) {
        return { incomplete: true as const, gap };
      }
      const documentVerified = await recomputeDocumentVerified(tx, tenant.id);
      return { incomplete: false as const, approved, documentIds, documentVerified };
    });

    if (outcome.incomplete) {
      return NextResponse.json(
        {
          error: {
            message: kycGapMessage(outcome.gap) ?? "Required documents are missing",
            code: "INCOMPLETE_KYC",
            gap: outcome.gap,
          },
        },
        { status: 409 },
      );
    }

    await prisma.notifications.create({
      data: {
        id: crypto.randomUUID(),
        profile_id: tenant.profile_id,
        title: "Documents Approved",
        message: "All active documents submitted to your hostel have been verified.",
        type: "INFO",
      },
    });

    await eventLog.log("documents_bulk_verified", tenant.owner_id || null, {
      tenant_id: tenant.id,
      document_ids: outcome.documentIds,
      verified_by: session.sub,
    }, tenant.id);

    return NextResponse.json({
      success: true,
      data: {
        approved_count: outcome.approved,
        document_ids: outcome.documentIds,
        document_verified: outcome.documentVerified,
      },
    });
  } catch (error) {
    console.error("Bulk verify documents error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
