export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_AGREEMENT_TEMPLATE } from "@/src/utils/default-rules";
import { normalizeAgreementTerms } from "@/src/services/agreements/agreement-terms";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";
import { buildAgreementDocument } from "@/src/services/agreements/agreement-document";

/**
 * The owner's preview of their own draft.
 *
 * Returns the **same** `AgreementDocument` the tenant reads and the PDF is made
 * from. The editor this replaces previewed a hand-rolled approximation that
 * omitted the preamble, the standard legal clauses, the execution statement and
 * the signature block — so an owner approved one document and issued another.
 *
 * Sample values, mirroring the sibling `preview/route.ts` that renders a sample
 * PDF, so the preview reads like an agreement rather than a page of tokens.
 * Unlike an issued agreement it composes with `isFinal: false`, because a
 * mistyped token must stay visible to the one person who can still fix it.
 *
 * See ADR-220.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    // Scoped to the caller. Never a "first hostel" fallback — that is the class
    // of bug `check:invariants` exists to catch.
    const hostel = await prisma.hostels.findFirst({
      where: { id: params.id, owner_id: session.sub },
      include: { profiles: { select: { name: true } } },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const rulesContent = body?.rules_content || DEFAULT_AGREEMENT_TEMPLATE;

    // The same normalisation the save route applies, so the preview cannot show
    // something that could never be persisted.
    const terms = normalizeAgreementTerms((rulesContent as any)?.terms_and_conditions);

    const ownerName = String(body?.owner_name || hostel.profiles?.name || hostel.name).trim();

    const sampleData: any = {
      hostelName: hostel.name,
      hostelAddress: [hostel.address, (hostel as any).city, (hostel as any).state, (hostel as any).pincode]
        .filter(Boolean)
        .join(", "),
      ownerName,
      tenantName: "Sample Tenant",
      roomNo: "101",
      monthlyRent: 8000,
      advanceDeposit: 16000,
      maintenanceCharge: 500,
      maintenanceType: "MONTHLY",
      joiningDate: new Date(),
      agreementStartDate: new Date(),
      paymentFrequency: "Monthly",
      hostelRules: rulesContent,
      termsAndConditions: terms,
      tenantSignatureName: null,
      tenantSignatureUrl: null,
      tenantSignedAt: null,
      tenantIp: null,
      tenantUserAgent: null,
      guardianSignatureName: null,
      guardianSignatureUrl: null,
      guardianRelation: null,
      guardianSignedAt: null,
      guardianIp: null,
      guardianUserAgent: null,
      ownerSignatureUrl: body?.owner_signature_url ? String(body.owner_signature_url).trim() : null,
      ownerSignedAt: null,
    };

    const document = buildAgreementDocument(
      agreementDocumentInputFromRenderData(sampleData, {
        reference: "PREVIEW",
        versionNumber: Number(body?.version_number ?? 0) || 0,
        status: "DRAFT",
        verificationUrl: null,
        isFinal: false,
      }),
    );

    return apiResponse({ document });
  } catch (error: any) {
    return apiError(error?.message || "Failed to compose preview", "INTERNAL_ERROR", 500);
  }
}
