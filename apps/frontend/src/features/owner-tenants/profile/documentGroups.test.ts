import { describe, expect, it } from 'vitest';
import { toDocumentGroups } from './documentGroups';

/**
 * The Documents tab presents two independent document systems plus the
 * agreement, and must never merge the first two.
 *
 * `identification_documents` carries a verdict scoped to the document.
 * `identity_document_shares` (the vault) carries a verdict scoped to the
 * *share*, i.e. to one hostel — a tenant carrying the same file to their next
 * hostel carries the file, not the decision. Collapsing them would silently
 * cross that boundary, so they stay side by side even when they describe the
 * same kind of document.
 */

function kycDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    docType: 'AADHAAR',
    status: 'PENDING',
    isActive: true,
    downloadUrl: 'https://api.example.com/d/1',
    latestRejectionReason: null,
    thread: [],
    uploadedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

function share(overrides: Record<string, unknown> = {}) {
  return {
    share_id: 'share-1',
    status: 'PENDING',
    verified_at: null,
    rejected_at: null,
    rejection_reason: null,
    tenant_id: 'tenant-1',
    document: { id: 'vault-1', doc_type: 'AADHAAR', profile: { id: 'p1', name: 'Sharan' } },
    ...overrides,
  };
}

describe('toDocumentGroups', () => {
  it('puts identification documents in the kyc group', () => {
    const groups = toDocumentGroups({ documents: [kycDoc()], shares: [], agreement: null });
    expect(groups.kyc.map((d) => d.id)).toEqual(['doc-1']);
  });

  it('lifts the agreement out of the document list into its own group', () => {
    const groups = toDocumentGroups({
      documents: [kycDoc(), kycDoc({ id: 'agr-1', docType: 'RENTAL_AGREEMENT' })],
      shares: [],
      agreement: null,
    });
    expect(groups.kyc.map((d) => d.id)).toEqual(['doc-1']);
    expect(groups.agreement?.id).toBe('agr-1');
  });

  it('carries agreement terms alongside the previewable document', () => {
    const groups = toDocumentGroups({
      documents: [kycDoc({ id: 'agr-1', docType: 'RENTAL_AGREEMENT' })],
      shares: [],
      agreement: {
        id: 'agr-1',
        status: 'SIGNED',
        agreement_start_date: '2026-08-15',
        agreement_end_date: '2027-07-14',
        contract_rent: 8000,
        contract_security_deposit: 16000,
        pdf_url: 'https://files.example.com/a.pdf',
      },
    });
    expect(groups.agreement).toMatchObject({
      id: 'agr-1',
      status: 'SIGNED',
      contractRent: 8000,
      contractDeposit: 16000,
    });
  });

  it('reports no agreement when neither a document nor terms exist', () => {
    const groups = toDocumentGroups({ documents: [kycDoc()], shares: [], agreement: null });
    expect(groups.agreement).toBeNull();
  });

  it('describes agreement terms even when no pdf has been generated', () => {
    const groups = toDocumentGroups({
      documents: [],
      shares: [],
      agreement: { id: 'agr-1', status: 'PENDING_SIGNATURE', pdf_url: null },
    });
    expect(groups.agreement).toMatchObject({ id: 'agr-1', previewable: false });
  });

  it('marks an agreement previewable only when a document backs it', () => {
    const groups = toDocumentGroups({
      documents: [kycDoc({ id: 'agr-1', docType: 'RENTAL_AGREEMENT' })],
      shares: [],
      agreement: { id: 'agr-1', status: 'SIGNED', pdf_url: 'https://f/a.pdf' },
    });
    expect(groups.agreement?.previewable).toBe(true);
  });

  it('surfaces a pending vault share as a review request', () => {
    const groups = toDocumentGroups({ documents: [], shares: [share()], agreement: null });
    expect(groups.reviewRequests.map((r) => r.shareId)).toEqual(['share-1']);
  });

  it('omits shares the owner has already ruled on', () => {
    const groups = toDocumentGroups({
      documents: [],
      shares: [share({ status: 'VERIFIED' }), share({ share_id: 'share-2', status: 'REJECTED' })],
      agreement: null,
    });
    expect(groups.reviewRequests).toEqual([]);
  });

  it('keeps a vault share separate from an identification document of the same type', () => {
    const groups = toDocumentGroups({
      documents: [kycDoc({ docType: 'AADHAAR' })],
      shares: [share({ document: { id: 'vault-1', doc_type: 'AADHAAR' } })],
      agreement: null,
    });
    expect(groups.kyc).toHaveLength(1);
    expect(groups.reviewRequests).toHaveLength(1);
    expect(groups.kyc[0].id).not.toBe(groups.reviewRequests[0].documentId);
  });

  it('reports whether anything is waiting on the owner', () => {
    const idle = toDocumentGroups({
      documents: [kycDoc({ status: 'VERIFIED' })],
      shares: [],
      agreement: null,
    });
    expect(idle.awaitingReviewCount).toBe(0);

    const busy = toDocumentGroups({
      documents: [kycDoc({ status: 'PENDING' })],
      shares: [share()],
      agreement: null,
    });
    expect(busy.awaitingReviewCount).toBe(2);
  });

  it('does not count a document the owner cannot act on as awaiting review', () => {
    const groups = toDocumentGroups({
      documents: [kycDoc({ status: 'MISSING' }), kycDoc({ id: 'd2', status: 'PENDING', isActive: false })],
      shares: [],
      agreement: null,
    });
    expect(groups.awaitingReviewCount).toBe(0);
  });

  it('treats absent inputs as empty rather than throwing', () => {
    const groups = toDocumentGroups({
      documents: undefined,
      shares: undefined,
      agreement: null,
    });
    expect(groups.kyc).toEqual([]);
    expect(groups.reviewRequests).toEqual([]);
    expect(groups.agreement).toBeNull();
    expect(groups.awaitingReviewCount).toBe(0);
  });

  it('reports whether the tab has anything at all to show', () => {
    const empty = toDocumentGroups({ documents: [], shares: [], agreement: null });
    expect(empty.isEmpty).toBe(true);

    const withDoc = toDocumentGroups({ documents: [kycDoc()], shares: [], agreement: null });
    expect(withDoc.isEmpty).toBe(false);
  });
});
