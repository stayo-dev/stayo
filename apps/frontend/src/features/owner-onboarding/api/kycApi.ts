import api from '@lib/api-client';

export interface OwnerKycDocument {
  id: string;
  doc_type: 'AADHAAR' | 'PAN' | 'PHOTO';
  file_url: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  uploaded_at: string;
}

/**
 * Owner KYC uploads (ADR-037). `status` is always PENDING on upload — only an
 * admin review can change it, so nothing here can claim to be verified.
 */
export const kycApi = {
  list: async () => {
    const response = await api.get('/owner/kyc-documents');
    return (response.data?.documents ?? []) as OwnerKycDocument[];
  },

  upload: async (docType: OwnerKycDocument['doc_type'], file: File) => {
    const form = new FormData();
    form.append('doc_type', docType);
    form.append('file', file);
    const response = await api.post('/owner/kyc-documents', form);
    return response.data?.document as OwnerKycDocument;
  },
};
