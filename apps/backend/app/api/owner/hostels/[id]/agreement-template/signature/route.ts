export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { eventSystem } from "@/lib/events";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const hostelId = params.id;
  try {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: session.sub, status: { in: ["ACTIVE", "INACTIVE"] } },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return apiError("No file uploaded", "VALIDATION_ERROR", 400);

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return apiError("Signature stamp must be JPEG, PNG, or WEBP", "VALIDATION_ERROR", 400);
    }
    if (file.size > 2 * 1024 * 1024) {
      return apiError("Signature stamp must be under 2MB", "VALIDATION_ERROR", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `hostel_${hostelId}_owner_sig_${Date.now()}.png`,
      folder: `owners/${session.sub}/hostels/${hostelId}/branding`,
      useUniqueFileName: true,
      tags: ["OWNER_SIGNATURE", hostelId],
    });

    // Update the active template's owner_signature_url
    const template = await prisma.agreementTemplate.findFirst({
      where: { hostel_id: hostelId, is_active: true },
      orderBy: { created_at: "desc" },
    });

    if (template) {
      const updatedTemplate = await prisma.agreementTemplate.update({
        where: { id: template.id },
        data: { owner_signature_url: upload.url },
      });

      await eventSystem.trigger("agreement_template_updated", {
        owner_id: session.sub,
        hostel_id: hostelId,
        actionType: "UPDATE_SIGNATURE",
        version: updatedTemplate.version,
        title: updatedTemplate.title,
        owner_signature_url: upload.url,
      }).catch((err: any) => console.error("Event trigger failed:", err));

      return apiResponse(updatedTemplate);
    } else {
      // If no template exists yet, create one
      const newTemplate = await prisma.agreementTemplate.create({
        data: {
          id: crypto.randomUUID(),
          hostel_id: hostelId,
          version: "v1-default",
          title: "Standard Tenant Agreement",
          owner_name: hostel.name,
          owner_signature_url: upload.url,
          custom_rules: "",
          is_active: true,
        },
      });

      await eventSystem.trigger("agreement_template_updated", {
        owner_id: session.sub,
        hostel_id: hostelId,
        actionType: "UPDATE_SIGNATURE",
        version: newTemplate.version,
        title: newTemplate.title,
        owner_signature_url: upload.url,
      }).catch((err: any) => console.error("Event trigger failed:", err));

      return apiResponse(newTemplate);
    }
  } catch (error: any) {
    return apiError(error.message || "Failed to upload owner signature stamp");
  }
}
