export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30; // a missing agreement PDF is rendered on demand

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { agreementDocumentAccessibleWhere } from "@/src/services/tenants/agreement-status";
import { AgreementGenerationService } from "@/src/services/tenants/agreement-generation-service";

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80) || "document";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { id: tenantId, docId } = params;

  let fileUrl: string | null;
  let docType: string;
  let mimeType: string;
  let docTenant: { id: string; profile_id: string | null; owner_id: string };

  const doc = await prisma.identificationDocument.findUnique({
    where: { id: docId },
    include: { tenant: { select: { id: true, profile_id: true, owner_id: true } } },
  });

  if (doc) {
    if (doc.tenant_id !== tenantId || !doc.is_active) {
      return NextResponse.json({ error: { message: "Document not found" } }, { status: 404 });
    }
    fileUrl = doc.file_url;
    docType = doc.doc_type;
    mimeType = doc.mime_type;
    docTenant = doc.tenant;
  } else {
    // Check if it's an agreement
    const agreement = await prisma.agreement.findFirst({
      where: { id: docId, tenant_id: tenantId, status: agreementDocumentAccessibleWhere() },
      include: { tenant: { select: { id: true, profile_id: true, owner_id: true } } },
    });
    if (!agreement) {
      return NextResponse.json({ error: { message: "Document not found" } }, { status: 404 });
    }
    // Null when the post-signing PDF upload failed — signing only logs that
    // failure, so a SIGNED agreement can have no file. It is rendered below,
    // after the access checks, instead of answering 404.
    fileUrl = agreement.pdf_url;
    docType = "RENTAL_AGREEMENT";
    mimeType = "application/pdf";
    docTenant = agreement.tenant;
  }

  if (session.role === "TENANT" && docTenant.profile_id !== session.sub) {
    return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
  }
  if (session.role === "OWNER" && docTenant.owner_id !== session.sub) {
    return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
  }
  if (!["TENANT", "OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
  }

  if (!fileUrl) {
    let pdf: Buffer;
    try {
      pdf = await AgreementGenerationService.renderPdf(docId);
    } catch (error) {
      console.error("[documents/download] agreement PDF render failed", { docId, error });
      return NextResponse.json({ error: { message: "Document file unavailable" } }, { status: 502 });
    }
    // Store it so the next view is a plain fetch. Best-effort: the owner or
    // tenant still gets the document if storage is down.
    try {
      await AgreementGenerationService.storePdf(docId, pdf);
    } catch (error) {
      console.error("[documents/download] agreement PDF store failed", { docId, error });
    }
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFileName(`rental_agreement-${docId}.pdf`)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const upstream = await fetch(fileUrl, { cache: "no-store" });
  if (!upstream.ok) {
    return NextResponse.json({ error: { message: "Document file unavailable" } }, { status: 502 });
  }

  const body = await upstream.arrayBuffer();
  const contentType = mimeType || upstream.headers.get("content-type") || "application/octet-stream";
  const extension = contentType.includes("pdf")
    ? "pdf"
    : contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeFileName(`${docType.toLowerCase()}-${docId}.${extension}`)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
