export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { backendUrl } from "@/lib/config/domains";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { id: tenantId, docId } = params;
    const body = await req.json().catch(() => ({}));
    const text = String(body.message || "").trim();

    if (!text) {
      return NextResponse.json({ error: { message: "Message cannot be empty" } }, { status: 400 });
    }
    if (text.length > 800) {
      return NextResponse.json({ error: { message: "Message must be under 800 characters" } }, { status: 400 });
    }

    const doc = await prisma.identificationDocument.findUnique({
      where: { id: docId },
      include: { tenant: { include: { profiles: true } } },
    });

    if (!doc || doc.tenant_id !== tenantId) {
      return NextResponse.json({ error: { message: "Document not found" } }, { status: 404 });
    }
    if (!doc.is_active) {
      return NextResponse.json({ error: { message: "Archived document threads are read-only" } }, { status: 409 });
    }

    const tenant = doc.tenant;

    let sender = "";
    let senderName = "";

    if (session.role === "TENANT") {
      if (tenant.profile_id !== session.sub) {
        return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
      }
      sender = "tenant";
      senderName = tenant.profiles?.name || "Tenant";
    } else if (["OWNER", "ADMIN"].includes(session.role)) {
      if (session.role === "OWNER" && tenant.owner_id !== session.sub) {
        return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
      }
      sender = "owner";
      const ownerProfile = await prisma.profile.findUnique({
        where: { id: session.sub },
        select: { name: true },
      });
      senderName = ownerProfile?.name || "Owner";
    } else {
      return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
    }

    // Parse existing messages or convert old rejection_reason
    let messages = [];
    try {
      if (doc.rejection_reason && doc.rejection_reason.startsWith("[") && doc.rejection_reason.endsWith("]")) {
        messages = JSON.parse(doc.rejection_reason);
      } else if (doc.rejection_reason) {
        messages = [{
          sender: "owner",
          sender_name: "Owner",
          message: doc.rejection_reason,
          timestamp: doc.updated_at || doc.created_at,
        }];
      }
    } catch {
      messages = [];
    }

    messages.push({
      sender,
      sender_name: senderName,
      message: text,
      timestamp: new Date().toISOString(),
    });

    // Update document. If tenant replied, keep it PENDING for owner's review!
    const updatedDoc = await prisma.identificationDocument.update({
      where: { id: docId },
      data: {
        rejection_reason: JSON.stringify(messages),
        ...(sender === "tenant" ? { document_status: "PENDING" } : {}),
      },
    });

    // Trigger standard notifications
    if (sender === "owner") {
      // Notify the tenant
      await prisma.notifications.create({
        data: {
          id: crypto.randomUUID(),
          profile_id: tenant.profile_id,
          title: "New Message on Document",
          message: `Owner commented on your ${doc.doc_type}: "${text}"`,
          type: "INFO",
        },
      });
    } else {
      // Notify the owner
      await prisma.notifications.create({
        data: {
          id: crypto.randomUUID(),
          profile_id: tenant.owner_id, // Owner's profile ID is owner_id
          title: "Tenant replied to Document query",
          message: `${senderName} commented on ${doc.doc_type}: "${text}"`,
          type: "INFO",
        },
      });
    }

    const { file_url, file_path, file_id, ...safeDoc } = updatedDoc;
    return NextResponse.json({
      success: true,
      data: {
        ...safeDoc,
        download_url: backendUrl(`/api/tenants/${tenantId}/documents/${docId}/download`),
      },
    });
  } catch (error) {
    console.error("Post document message error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
