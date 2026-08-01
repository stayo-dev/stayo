import { describe, expect, it } from 'vitest';
import {
  PENDING_VERIFICATIONS_PATH,
  canActOnDocument,
  documentTypeLabel,
  groupPendingByTenant,
  isRejectReasonValid,
  parseRejectionThread,
  pendingVerificationsRoute,
  toReviewDocument,
} from './kycDocuments';

/**
 * Owner KYC verification (audit item P0-4).
 *
 * The backend has had verify/reject/download for a long time; the owner had no
 * way to reach any of it, so tenants could upload documents that nobody could
 * ever approve and onboarding stopped dead. These tests pin the decision logic
 * the new UI renders on top of — chiefly which documents are actionable, and
 * how the rejection thread the backend stores is read back.
 */

const OWNER_REJECTION_THREAD = JSON.stringify([
  { sender: 'owner', sender_name: 'Priya', message: 'Blurry, please re-upload', timestamp: '2026-08-01T10:00:00.000Z' },
  { sender: 'tenant', sender_name: 'Arjun', message: 'Uploaded a clearer one', timestamp: '2026-08-01T11:00:00.000Z' },
]);

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    doc_type: 'AADHAAR',
    document_status: 'PENDING',
    is_active: true,
    is_verified: false,
    rejection_reason: null,
    download_url: 'https://api.yourstayo.com/api/tenants/t1/documents/doc-1/download',
    created_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('toReviewDocument', () => {
  it('carries the download url through — View and Download both need it', () => {
    expect(toReviewDocument(doc()).downloadUrl).toBe(
      'https://api.yourstayo.com/api/tenants/t1/documents/doc-1/download',
    );
  });

  it('maps APPROVED to a verified status', () => {
    expect(toReviewDocument(doc({ document_status: 'APPROVED', is_verified: true })).status).toBe('VERIFIED');
  });

  it('maps REJECTED through unchanged', () => {
    expect(toReviewDocument(doc({ document_status: 'REJECTED' })).status).toBe('REJECTED');
  });

  it('treats anything unrecognised as still pending, never as verified', () => {
    expect(toReviewDocument(doc({ document_status: 'WHATEVER' })).status).toBe('PENDING');
    expect(toReviewDocument(doc({ document_status: undefined })).status).toBe('PENDING');
  });

  it('surfaces the latest owner rejection message as the headline reason', () => {
    const reviewed = toReviewDocument(doc({ document_status: 'REJECTED', rejection_reason: OWNER_REJECTION_THREAD }));

    expect(reviewed.latestRejectionReason).toBe('Blurry, please re-upload');
  });

  it('has no rejection reason when the document was never rejected', () => {
    expect(toReviewDocument(doc()).latestRejectionReason).toBeNull();
  });

  it('keeps the raw doc type so mutations can be issued against it', () => {
    expect(toReviewDocument(doc()).docType).toBe('AADHAAR');
    expect(toReviewDocument(doc()).id).toBe('doc-1');
  });
});

describe('parseRejectionThread', () => {
  // The backend stores this column two different ways depending on its age:
  // a JSON array of messages, or (legacy rows) a bare string.
  it('reads the JSON message thread the backend writes', () => {
    const thread = parseRejectionThread(OWNER_REJECTION_THREAD);

    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({ sender: 'owner', message: 'Blurry, please re-upload' });
    expect(thread[1]).toMatchObject({ sender: 'tenant', message: 'Uploaded a clearer one' });
  });

  it('treats a legacy plain-string reason as a single owner message', () => {
    const thread = parseRejectionThread('Document expired');

    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ sender: 'owner', message: 'Document expired' });
  });

  it('returns nothing for an empty or missing reason', () => {
    expect(parseRejectionThread(null)).toEqual([]);
    expect(parseRejectionThread('')).toEqual([]);
    expect(parseRejectionThread(undefined)).toEqual([]);
  });

  it('does not throw on malformed JSON', () => {
    expect(() => parseRejectionThread('[{broken')).not.toThrow();
    expect(parseRejectionThread('[{broken')).toEqual([]);
  });

  it('ignores entries that carry no message text', () => {
    expect(parseRejectionThread(JSON.stringify([{ sender: 'owner' }, { sender: 'owner', message: 'ok' }]))).toHaveLength(1);
  });
});

describe('canActOnDocument', () => {
  // Mirrors the guards the routes already enforce, so the UI doesn't offer a
  // button that is going to come back 409/400.
  it('allows approving and rejecting a pending document', () => {
    expect(canActOnDocument(toReviewDocument(doc()))).toBe(true);
  });

  it('allows re-approving a rejected document — the tenant may have re-uploaded', () => {
    expect(canActOnDocument(toReviewDocument(doc({ document_status: 'REJECTED' })))).toBe(true);
  });

  it('offers no action on an already-verified document', () => {
    expect(canActOnDocument(toReviewDocument(doc({ document_status: 'APPROVED', is_verified: true })))).toBe(false);
  });

  it('offers no action on an archived document — the route answers 409', () => {
    expect(canActOnDocument(toReviewDocument(doc({ is_active: false })))).toBe(false);
  });

  it('offers no action on a document that was never uploaded', () => {
    expect(canActOnDocument({ id: 'missing-AADHAAR', docType: 'AADHAAR', status: 'MISSING', isActive: false, downloadUrl: null, latestRejectionReason: null, thread: [], uploadedAt: null })).toBe(false);
  });
});

describe('isRejectReasonValid', () => {
  // The route answers 400 without a reason and 400 over 800 characters.
  it('requires a reason', () => {
    expect(isRejectReasonValid('')).toBe(false);
    expect(isRejectReasonValid('   ')).toBe(false);
  });

  it('accepts a real reason', () => {
    expect(isRejectReasonValid('Photo is blurry')).toBe(true);
  });

  it('rejects a reason over the backend 800-character cap', () => {
    expect(isRejectReasonValid('x'.repeat(800))).toBe(true);
    expect(isRejectReasonValid('x'.repeat(801))).toBe(false);
  });
});

describe('groupPendingByTenant', () => {
  const pending = [
    { id: 'd1', tenant_id: 't1', tenant_name: 'Arjun Mehta', doc_type: 'AADHAAR', room_no: '101', hostel_name: 'MG Road', download_url: 'u1', uploaded_at: '2026-08-01T09:00:00.000Z' },
    { id: 'd2', tenant_id: 't1', tenant_name: 'Arjun Mehta', doc_type: 'COLLEGE_ID', room_no: '101', hostel_name: 'MG Road', download_url: 'u2', uploaded_at: '2026-08-01T10:00:00.000Z' },
    { id: 'd3', tenant_id: 't2', tenant_name: 'Neha Rao', doc_type: 'AADHAAR', room_no: '204', hostel_name: 'Whitefield', download_url: 'u3', uploaded_at: '2026-08-01T08:00:00.000Z' },
  ];

  it('groups documents under the tenant who uploaded them', () => {
    const groups = groupPendingByTenant(pending);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.tenantId === 't1')?.documents).toHaveLength(2);
    expect(groups.find((g) => g.tenantId === 't2')?.documents).toHaveLength(1);
  });

  it('keeps the tenant context the owner needs to judge the document', () => {
    const arjun = groupPendingByTenant(pending).find((g) => g.tenantId === 't1')!;

    expect(arjun.tenantName).toBe('Arjun Mehta');
    expect(arjun.roomNo).toBe('101');
    expect(arjun.hostelName).toBe('MG Road');
  });

  it('puts the tenant who has waited longest first', () => {
    expect(groupPendingByTenant(pending).map((g) => g.tenantId)).toEqual(['t2', 't1']);
  });

  it('returns nothing for an empty queue, so the caller can show a success state', () => {
    expect(groupPendingByTenant([])).toEqual([]);
  });

  it('survives a non-array payload rather than crashing the page', () => {
    expect(groupPendingByTenant(null)).toEqual([]);
    expect(groupPendingByTenant(undefined)).toEqual([]);
  });
});

describe('documentTypeLabel', () => {
  it('names the types the backend requires', () => {
    expect(documentTypeLabel('AADHAAR')).toBe('Aadhaar Card');
    expect(documentTypeLabel('COLLEGE_ID')).toBe('College ID');
    expect(documentTypeLabel('WORK_ID')).toBe('Work ID');
  });

  it('falls back to the raw type rather than showing nothing', () => {
    expect(documentTypeLabel('PASSPORT')).toBe('PASSPORT');
  });
});

describe('navigation', () => {
  it('exposes the pending-verifications path as a single source of truth', () => {
    expect(PENDING_VERIFICATIONS_PATH).toBe('/owner/tenants/verifications');
  });

  it('routes the Verify KYC card at the pending-verifications queue', () => {
    expect(pendingVerificationsRoute()).toBe('/owner/tenants/verifications');
  });

  it('can deep-link straight to one tenant', () => {
    expect(pendingVerificationsRoute('t1')).toBe('/owner/tenants/verifications?tenantId=t1');
  });
});
