import api from '@lib/api-client';

const LEAD_OTP_PURPOSE = 'LEAD_CAPTURE';

export const hostelLeadsApi = {
  // `verification_required: false` means WhatsApp could not deliver a code and
  // the backend has already recorded the number as unverified — the caller
  // must skip its OTP step rather than wait for a code that will never arrive.
  sendLeadOtp: async (phone: string) => {
    const response = await api.post('/auth/send-phone-otp', { phone, purpose: LEAD_OTP_PURPOSE });
    return response.data as {
      success: boolean;
      verification_required: boolean;
      expires_in_seconds?: number;
      reason?: string;
    };
  },
  verifyLeadOtp: async (phone: string, otp: string) => {
    const response = await api.post('/auth/verify-phone-otp', { phone, otp, purpose: LEAD_OTP_PURPOSE });
    return response.data as { success: boolean; phone_verified: boolean };
  },
  submitLead: async (data: {
    name: string;
    hostel_name: string;
    phone: string;
    city?: string;
    bed_count?: number;
    pain_point?: string;
    current_tooling?: string;
    google_email?: string;
  }) => {
    const response = await api.post('/leads/self-serve', data);
    return response.data as { success: boolean; id: string; status: string; tracking_token: string; duplicate: boolean };
  },
  getEnquiryStatus: async (token: string) => {
    const response = await api.get(`/leads/track/${token}`);
    return response.data as {
      hostel_name: string;
      submitted_at: string;
      stage: string;
      is_terminal: boolean;
      timeline: Array<{ key: string; label: string; state: 'done' | 'current' | 'pending' }>;
      applicant_message: string | null;
      rejection_reason: string | null;
    };
  },
  /**
   * Attaches a Google email to a lead that already exists. Used after the
   * OAuth round-trip, since the lead is saved at the phone step — before
   * Google is ever offered.
   */
  linkLeadEmail: async (trackingToken: string, googleEmail: string) => {
    const response = await api.post(`/leads/track/${trackingToken}/link-email`, {
      google_email: googleEmail,
    });
    return response.data as { success: boolean; linked: boolean; reason?: string };
  },
  getInvitationContext: async (token: string) => {
    const response = await api.get(`/leads/invitation/${token}`);
    return response.data as { name: string; hostel_name: string; phone: string; google_email: string | null; city: string | null };
  },
  completeInvitation: async (token: string) => {
    const response = await api.post(`/leads/invitation/${token}/complete`);
    return response.data;
  },
  /**
   * Completes activation for a lead-approved owner. `email` is only sent
   * when the lead has no `google_email` on file — the backend derives
   * everything else (name, hostel, verified phone) from the lead itself and
   * rejects the token if it's invalid, expired, cancelled, or already used.
   */
  activateInvitation: async (
    token: string,
    data: { email?: string; password: string; confirm_password: string },
  ) => {
    const response = await api.post('/auth/owner-signup', { lead_token: token, ...data });
    return response.data as { success: boolean; access_token: string; refresh_token: string };
  },
};
