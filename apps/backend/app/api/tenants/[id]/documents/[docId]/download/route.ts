export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { agreementDocumentAccessibleWhere } from "@/src/services/tenants/agreement-status";

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

  let fileUrl: string;
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
    if (!agreement || !agreement.pdf_url) {
      return NextResponse.json({ error: { message: "Document not found" } }, { status: 404 });
    }
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
