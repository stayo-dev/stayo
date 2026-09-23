import api from '@lib/api-client';

/**
 * The marketplace-partner surfaces. Every call is bearer-token, not session:
 * a partner is a hostel owner who has no Stayo account yet, which is the
 * whole point of these pages.
 */

export type PartnerEnquiryRow = {
  id: string;
  state: 'PENDING' | 'SENT' | 'HELD' | 'RELEASED' | 'FAILED' | 'EXPIRED';
  received_at: string;
  hostel_name: string | null;
  student_name: string | null;
  student_phone: string | null;
  /** Null while the enquiry is locked — there is nothing to open. */
  token: string | null;
};

export type PartnerPortal = {
  partner_name: string;
  converted: boolean;
  listings: {
    hostel: { id: string; name: string; city: string | null; public_slug: string | null } | null;
    free_quota: number;
    delivered: number;
  }[];
  enquiries: PartnerEnquiryRow[];
};

export type PartnerEnquiry = {
  state: PartnerEnquiryRow['state'];
  unlocked: boolean;
  hostel_name: string | null;
  received_at: string;
  student: { name: string | null; phone: string | null; email: string | null; note: string | null };
  partner_name: string;
};

export type PartnerActivation = {
  partner_name: string;
  already_converted: boolean;
  hostels: { id: string; name: string; city: string | null; public_slug: string | null }[];
  held_enquiries: number;
  unlocking_delivery_id: string | null;
};

export const partnerApi = {
  getPortal: async (token: string) => {
    const response = await api.get(`/partner/${token}`);
    return response.data as PartnerPortal;
  },
  getEnquiry: async (token: string) => {
    const response = await api.get(`/partner/enquiry/${token}`);
    return response.data as PartnerEnquiry;
  },
  getActivation: async (token: string) => {
    const response = await api.get(`/partner/activate/${token}`);
    return response.data as PartnerActivation;
  },
  claim: async (token: string) => {
    const response = await api.post(`/partner/activate/${token}`, {});
    return response.data as { claimed_hostels: string[]; released_enquiries: number };
  },
};
