/**
 * How the Documents tab is organised.
 *
 * Three groups, and the first two are deliberately never merged:
 *
 *  1. **Review requests** — `identity_document_shares`, the profile-scoped
 *     vault (ADR-110/111/112). A verdict here is written to the *share*, so it
 *     applies to this hostel only; a tenant carrying the same file to their
 *     next hostel carries the file, not the decision.
 *  2. **KYC documents** — `identification_documents`, tenant-scoped, where a
 *     verdict is written to the document itself.
 *  3. **Agreement** — surfaced separately because the backend already returns
 *     it as a virtual `RENTAL_AGREEMENT` row inside the document list, which
 *     would otherwise sit among the KYC cards as if it were one.
 *
 * Collapsing 1 and 2 would quietly cross the per-hostel boundary, so a vault
 * Aadhaar and an identification Aadhaar appear as two separate things even
 * though they describe the same kind of document.
 */

import type { ReviewDocument } from '../documents/kycDocuments';
import { canActOnDocument } from '../documents/kycDocuments';

export interface ShareReviewRequest {
  shareId: string;
  documentId: string;
  docType: string;
  ownerName: string | null;
  status: string;
}

export interface AgreementSummary {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  contractRent: number | null;
  contractDeposit: number | null;
  /** True only when a document actually backs it — an unsigned agreement has no file. */
  previewable: boolean;
}

export interface DocumentGroups {
  reviewRequests: ShareReviewRequest[];
  kyc: ReviewDocument[];
  agreement: AgreementSummary | null;
  /** How many things are genuinely waiting on an owner decision, across both systems. */
  awaitingReviewCount: number;
  isEmpty: boolean;
}

export interface DocumentGroupsInput {
  documents: ReviewDocument[] | undefined | null;
  shares: Array<Record<string, any>> | undefined | null;
  agreement: Record<string, any> | null | undefined;
}

const AGREEMENT_DOC_TYPE = 'RENTAL_AGREEMENT';

function num(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function text(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function toDocumentGroups({
  documents,
  shares,
  agreement,
}: DocumentGroupsInput): DocumentGroups {
  const allDocuments = Array.isArray(documents) ? documents : [];

  const agreementDoc = allDocuments.find((doc) => doc.docType === AGREEMENT_DOC_TYPE) ?? null;
  const kyc = allDocuments.filter((doc) => doc.docType !== AGREEMENT_DOC_TYPE);

  // Only shares still awaiting a verdict are review *requests*. A share the
  // owner already ruled on is history, and belongs on the document it backs.
  const reviewRequests: ShareReviewRequest[] = (Array.isArray(shares) ? shares : [])
    .filter((share) => String(share?.status ?? '').toUpperCase() === 'PENDING')
    .map((share) => ({
      shareId: String(share.share_id ?? share.id ?? ''),
      documentId: String(share.document?.id ?? ''),
      docType: String(share.document?.doc_type ?? ''),
      ownerName: text(share.document?.profile?.name),
      status: String(share.status ?? 'PENDING'),
    }))
    .filter((request) => request.shareId.length > 0);

  let agreementSummary: AgreementSummary | null = null;
  if (agreement || agreementDoc) {
    const id = String(agreement?.id ?? agreementDoc?.id ?? '');
    agreementSummary = {
      id,
      status: String(agreement?.status ?? 'SIGNED'),
      startDate: text(agreement?.agreement_start_date),
      endDate: text(agreement?.agreement_end_date),
      contractRent: num(agreement?.contract_rent),
      contractDeposit: num(agreement?.contract_security_deposit),
      previewable: agreementDoc != null,
    };
  }

  const awaitingReviewCount =
    kyc.filter((doc) => doc.status === 'PENDING' && canActOnDocument(doc)).length +
    reviewRequests.length;

  return {
    reviewRequests,
    kyc,
    agreement: agreementSummary,
    awaitingReviewCount,
    isEmpty: kyc.length === 0 && reviewRequests.length === 0 && agreementSummary === null,
  };
}
