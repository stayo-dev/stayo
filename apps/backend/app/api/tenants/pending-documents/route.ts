export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { backendUrl } from "@/lib/config/domains";
import { requiredKycDocTypes } from "@/src/services/tenants/kyc-status";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "OWNER") {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");

    const ownerScopedTenant = {
      owner_id: session.sub,
      ...(hostelId ? { hostel_id: hostelId } : {}),
    };

    const documents = await prisma.identificationDocument.findMany({
      where: {
        document_status: "PENDING",
        is_active: true,
        tenant: ownerScopedTenant,
      },
      include: {
        tenant: {
          include: {
            profiles: {
              select: {
                name: true,
                phone: true,
              },
            },
            room_allocations: {
              where: { is_active: true },
              include: {
                room: {
                  select: {
                    room_no: true,
                  },
                },
              },
            },
            hostels: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const items = documents.map((doc) => {
      if (!requiredKycDocTypes(doc.tenant.profile_type).includes(doc.doc_type)) return null;
      const activeAlloc = doc.tenant.room_allocations[0];
      return {
        id: doc.id,
        tenant_id: doc.tenant_id,
        doc_type: doc.doc_type,
        doc_number: doc.doc_number,
        document_status: doc.document_status,
        download_url: backendUrl(`/api/tenants/${doc.tenant_id}/documents/${doc.id}/download`),
        mime_type: doc.mime_type,
        file_size: doc.file_size,
        uploaded_at: doc.created_at,
        tenant_name: doc.tenant.profiles?.name || "Tenant",
        tenant_phone: doc.tenant.profiles?.phone || doc.tenant.phone_1 || "",
        photo_url: doc.tenant.photo_url || null,
        room_no: activeAlloc?.room?.room_no || "N/A",
        hostel_name: doc.tenant.hostels?.name || "Hostel",
        hostel_id: doc.tenant.hostel_id,
      };
    }).filter(Boolean);

    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    console.error("Fetch pending documents error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
