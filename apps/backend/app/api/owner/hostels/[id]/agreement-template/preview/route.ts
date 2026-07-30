export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AgreementTemplateType } from "@prisma/client";
import { DEFAULT_AGREEMENT_TEMPLATE } from "@/src/utils/default-rules";
import { AgreementGenerationService } from "@/src/services/tenants/agreement-generation-service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const hostelId = params.id;
  try {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: session.sub },
      include: { profiles: { select: { name: true } } },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const body = await req.json();
    const typeParam = body.type || "RESIDENCY";

    if (typeParam !== "RESIDENCY") {
      return apiError("Invalid template type", "VALIDATION_ERROR", 400);
    }

    const title = String(body.title || "Standard Tenant Agreement").trim();
    const owner_name = String(body.owner_name || hostel.profiles?.name || hostel.name).trim();
    const owner_signature_url = body.owner_signature_url ? String(body.owner_signature_url).trim() : null;
    const custom_rules = String(body.custom_rules || "").trim();
    const rules_content = body.rules_content || DEFAULT_AGREEMENT_TEMPLATE;

    // Build mock agreement data matching AgreementData structure for preview
    const mockData = {
      hostelName: hostel.name,
      hostelAddress: hostel.address || "123 Hostel St",
      ownerName: owner_name,
      ownerSignatureUrl: owner_signature_url,
      tenantName: "John Doe (Sample Tenant)",
      tenantEmail: "tenant@example.com",
      tenantPhone: "+91 98765 43210",
      permanentAddress: "456 Permanent Address Rd, City, State",
      roomNo: "101-A",
      monthlyRent: 5000,
      advanceDeposit: 10000,
      maintenanceCharge: 500,
      maintenanceType: "MONTHLY",
      joiningDate: new Date(),
      paymentFrequency: "Monthly",
      customRules: custom_rules,
      hostelRules: rules_content,
      tenantSignatureUrl: null,
      tenantSignatureName: null,
      tenantSignedAt: null,
      tenantIp: null,
      tenantUserAgent: null,
      guardianSignatureUrl: null,
      guardianSignatureName: null,
      guardianRelation: null,
      guardianSignedAt: null,
      guardianIp: null,
      guardianUserAgent: null,
      ownerSignedAt: new Date(),
    };

    const pdfBuffer = await AgreementGenerationService.generatePdfBuffer(mockData);

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=agreement-preview.pdf",
      },
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to generate agreement preview");
  }
}
