import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * The one place that answers "what KYC does this tenant owe, and is it done?".
 *
 * Before this module the answer was copy-pasted into ~12 routes and services,
 * each deriving `tenants.document_verified` slightly differently — some from a
 * bare `count > 0`, some without checking the document was still active, none
 * recomputing when `profile_type` changed. See [[Bugs]].
 *
 * Scope: `identification_documents` (tenant KYC) only. The Portable Vault
 * (`identity_documents` / `identity_document_shares`) is a separate system with
 * its own per-hostel verdicts — `document-vault-service.ts` keeps its own copy
 * of the required-types list on purpose. Do not merge them.
 */

export const KYC_REQUIRED_BY_PROFILE_TYPE = {
  STUDENT: ["AADHAAR", "COLLEGE_ID"],
  WORKING_PROFESSIONAL: ["AADHAAR", "WORK_ID"],
} as const;

export const KYC_DOC_TYPE_LABEL: Record<string, string> = {
  AADHAAR: "Aadhaar",
  COLLEGE_ID: "College ID",
  WORK_ID: "Work ID",
};

/** The minimum shape any caller needs to pass in for a KYC judgement. */
export type KycDocLike = {
  doc_type: string;
  document_status?: string | null;
  is_verified?: boolean | null;
  is_active?: boolean | null;
};

/** Required document types for a tenant, defaulting to STUDENT. */
export function requiredKycDocTypes(profileType?: string | null): string[] {
  const key = String(profileType || "STUDENT").toUpperCase();
  return key === "WORKING_PROFESSIONAL"
    ? [...KYC_REQUIRED_BY_PROFILE_TYPE.WORKING_PROFESSIONAL]
    : [...KYC_REQUIRED_BY_PROFILE_TYPE.STUDENT];
}

/** A document counts as verified only when an owner/admin has actually approved it. */
export function isApprovedKycDoc(doc: KycDocLike): boolean {
  return String(doc.document_status || "").toUpperCase() === "APPROVED" && doc.is_verified === true;
}

/** Archived rows are history — never usable to satisfy current KYC. */
function activeOnly(docs: readonly KycDocLike[]): KycDocLike[] {
  return (docs ?? []).filter((doc) => doc.is_active !== false);
}

/**
 * True iff, for every required type, there is a currently-active document that
 * has been APPROVED. A missing, pending, rejected, or archived document does
 * not count.
 */
export function isKycComplete(profileType: string | null | undefined, docs: readonly KycDocLike[]): boolean {
  const required = requiredKycDocTypes(profileType);
  const active = activeOnly(docs);
  return required.every((type) =>
    active.some((doc) => String(doc.doc_type).toUpperCase() === type && isApprovedKycDoc(doc)),
  );
}

export type KycGap = {
  missing: string[];
  pending: string[];
  rejected: string[];
  complete: boolean;
};

/** Break down exactly what stands between this tenant and verified KYC. */
export function describeKycGap(profileType: string | null | undefined, docs: readonly KycDocLike[]): KycGap {
  const required = requiredKycDocTypes(profileType);
  const active = activeOnly(docs);
  const missing: string[] = [];
  const pending: string[] = [];
  const rejected: string[] = [];

  for (const type of required) {
    const matches = active.filter((doc) => String(doc.doc_type).toUpperCase() === type);
    if (matches.length === 0) {
      missing.push(type);
    } else if (matches.some(isApprovedKycDoc)) {
      // satisfied
    } else if (matches.some((doc) => String(doc.document_status || "").toUpperCase() === "REJECTED")) {
      rejected.push(type);
    } else {
      pending.push(type);
    }
  }

  return {
    missing,
    pending,
    rejected,
    complete: missing.length === 0 && pending.length === 0 && rejected.length === 0,
  };
}

/** A one-line, human explanation of a gap — for API error bodies and UI. */
export function kycGapMessage(gap: KycGap): string | null {
  if (gap.complete) return null;
  const label = (type: string) => KYC_DOC_TYPE_LABEL[type] ?? type;
  const parts: string[] = [];
  if (gap.rejected.length > 0) {
    parts.push(`${gap.rejected.map(label).join(" and ")} ${gap.rejected.length > 1 ? "were" : "was"} rejected — a new copy is needed`);
  }
  if (gap.missing.length > 0) {
    parts.push(`${gap.missing.map(label).join(" and ")} still to upload`);
  }
  if (gap.pending.length > 0) {
    parts.push(`${gap.pending.map(label).join(" and ")} awaiting verification`);
  }
  return parts.join("; ");
}

type TxClient = Prisma.TransactionClient | PrismaClient;

/**
 * Recompute and persist `tenants.document_verified` from the tenant's current
 * active `identification_documents`. This is the only place that column should
 * be written after invitation creation — every route that approves, rejects,
 * re-uploads, or changes `profile_type` calls this instead of setting the flag
 * directly. Pass a transaction client so it runs inside the caller's `$transaction`.
 *
 * Returns the resulting value.
 */
export async function recomputeDocumentVerified(tx: TxClient, tenantId: string): Promise<boolean> {
  const tenant = await tx.tenants.findUnique({
    where: { id: tenantId },
    select: { id: true, profile_type: true, document_verified: true },
  });
  if (!tenant) return false;

  const docs = await tx.identificationDocument.findMany({
    where: { tenant_id: tenantId, is_active: true },
    select: { doc_type: true, document_status: true, is_verified: true, is_active: true },
  });

  const verified = isKycComplete(tenant.profile_type, docs as KycDocLike[]);
  if (verified !== tenant.document_verified) {
    await tx.tenants.update({ where: { id: tenantId }, data: { document_verified: verified } });
  }
  return verified;
}

/**
 * Approve every required, currently-active document for a tenant — the shared
 * core of `bulk-verify` and the `MARK_DOCUMENTS_VERIFIED` compliance action.
 *
 * Refuses (via `gap.missing`) when a required type has no active row at all:
 * neither surface may conjure verification for a document that was never
 * uploaded. Only flips rows that are not already APPROVED; never touches
 * archived rows, other document types, or another tenant's documents. The
 * caller is responsible for calling {@link recomputeDocumentVerified} after.
 */
export async function approveRequiredActiveKycDocs(
  tx: TxClient,
  tenant: { id: string; profile_type?: string | null },
  reviewerId: string,
): Promise<{ approved: number; gap: KycGap; documentIds: string[] }> {
  const required = requiredKycDocTypes(tenant.profile_type);
  const active = await tx.identificationDocument.findMany({
    where: { tenant_id: tenant.id, is_active: true, doc_type: { in: required } },
    select: { id: true, doc_type: true, document_status: true, is_verified: true, is_active: true },
  });

  const gap = describeKycGap(tenant.profile_type, active as KycDocLike[]);
  if (gap.missing.length > 0) {
    return { approved: 0, gap, documentIds: [] };
  }

  const toApprove = active.filter(
    (doc) => String(doc.document_status || "").toUpperCase() !== "APPROVED" || !doc.is_verified,
  );
  if (toApprove.length > 0) {
    await tx.identificationDocument.updateMany({
      where: { id: { in: toApprove.map((doc) => doc.id) }, is_active: true },
      data: {
        document_status: "APPROVED",
        is_verified: true,
        approved_by: reviewerId,
        approved_at: new Date(),
      },
    });
  }

  return { approved: toApprove.length, gap, documentIds: active.map((doc) => doc.id) };
}
