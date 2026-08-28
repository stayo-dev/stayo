import api from '@lib/api-client';

/**
 * Vault documents a tenant has shared with this hostel for review.
 *
 * `identity_document_shares` is a different system from the tenant-scoped
 * `identification_documents` the KYC cards act on, and deliberately so: a
 * verdict here is written to the **share**, so it applies to this hostel only.
 * A tenant carrying the same file to their next hostel carries the file, not
 * the decision.
 *
 * Both endpoints existed with no frontend caller at all, so a tenant who
 * shared a document created a review request no owner could see or act on.
 */

export interface DocumentShare {
  share_id: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verified_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  tenant_id: string | null;
  document: {
    id: string;
    doc_type: string;
    doc_number: string | null;
    /** Raw ImageKit URL — third-party host, never fetched with our session. */
    file_url: string;
    mime_type: string;
    file_size: number;
    is_active: boolean;
    created_at: string;
    profile?: { id: string; name: string | null } | null;
  };
}

export const documentShareService = {
  /**
   * `hostel_id` is required and never defaulted — the route refuses without
   * it, because falling back to "the owner's first hostel" would show a
   * multi-hostel owner documents shared with a different property.
   */
  listForTenant: async (hostelId: string, profileId: string) => {
    const response = await api.get('/owner/document-shares', {
      params: { hostel_id: hostelId, profile_id: profileId },
    });
    const data = response.data?.data !== undefined ? response.data.data : response.data;
    return (Array.isArray(data) ? data : []) as DocumentShare[];
  },

  setVerdict: async (shareId: string, verdict: 'VERIFIED' | 'REJECTED', rejectionReason?: string) => {
    const response = await api.patch(`/owner/document-shares/${shareId}/verdict`, {
      verdict,
      rejection_reason: rejectionReason,
    });
    return response.data?.data !== undefined ? response.data.data : response.data;
  },
};
