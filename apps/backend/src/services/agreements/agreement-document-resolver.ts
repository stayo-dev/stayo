/**
 * Stored agreement → composer input.
 *
 * Split in two on purpose. This module is pure and carries every decision that
 * shapes the document's facts table — which rows, in what order, how money and
 * absent values read — so it is tested without a database or a PDF. Fetching
 * belongs to the callers, which already hold the agreement row (they need
 * `version_number` and `status` from it, which `getAgreementRenderData` does
 * not return).
 *
 * It reads from `getAgreementRenderData`, which is already snapshot-first: a
 * signed agreement must render from what was signed, never from the hostel's
 * current template.
 */
import { rupees } from "./agreement-boilerplate";
import type { AgreementDocumentInput } from "./agreement-document";
// Type-only: importing the value side would drag pdf-lib, Prisma, ImageKit and
// axios into a module that needs none of them.
import type { AgreementData } from "../tenants/agreement-generation-service";
import { formatAgreementDate } from "./agreement-dates";

const EM_DASH = "—";

export function agreementDocumentInputFromRenderData(
  data: AgreementData,
  opts: { reference: string; versionNumber: number; status: string; verificationUrl: string | null },
): AgreementDocumentInput {
  const joining = formatAgreementDate(data.agreementStartDate || data.joiningDate);
  const maintenance = Number(data.maintenanceCharge || 0);

  return {
    reference: opts.reference,
    hostelName: data.hostelName,
    hostelAddress: data.hostelAddress,
    ownerName: data.ownerName,
    tenantName: data.tenantName,
    versionNumber: opts.versionNumber,
    status: opts.status,
    generatedAt: new Date().toISOString(),
    executionDateDisplay: data.ownerSignedAt
      ? formatAgreementDate(data.ownerSignedAt)
      : formatAgreementDate(data.agreementStartDate || data.joiningDate),
    verificationUrl: opts.verificationUrl,
    facts: [
      { label: "Room", value: data.roomNo || EM_DASH },
      { label: "Joining Date", value: joining },
      { label: "Monthly Rent", value: rupees(Number(data.monthlyRent || 0)) },
      { label: "Security Deposit", value: rupees(Number(data.advanceDeposit || 0)) },
      // A dash, not "₹0/mo": a zero charge reads as a fault rather than as the
      // absence of a charge.
      { label: "Maintenance", value: maintenance > 0 ? `${rupees(maintenance)}/mo` : EM_DASH },
      { label: "Payment Cycle", value: data.paymentFrequency || "Monthly" },
    ],
    terms: data.termsAndConditions ?? [],
    rules: (data.hostelRules as AgreementDocumentInput["rules"]) ?? null,
    variables: {
      TENANT_NAME: data.tenantName,
      ROOM_NUMBER: data.roomNo || "",
      MONTHLY_RENT: Number(data.monthlyRent || 0),
      SECURITY_DEPOSIT_AMOUNT: Number(data.advanceDeposit || 0),
      MAINTENANCE_CHARGE_AMOUNT: maintenance,
      HOSTEL_NAME: data.hostelName,
      OWNER_NAME: data.ownerName,
      JOINING_DATE: joining,
    },
    // A stored agreement is being issued, not drafted.
    isFinal: true,
    signatures: {
      tenantName: data.tenantSignatureName ?? null,
      tenantSignatureUrl: data.tenantSignatureUrl ?? null,
      guardianName: data.guardianSignatureName ?? null,
      guardianSignatureUrl: data.guardianSignatureUrl ?? null,
      guardianRelation: data.guardianRelation ?? null,
      ownerSignatureUrl: data.ownerSignatureUrl ?? null,
    },
  };
}
