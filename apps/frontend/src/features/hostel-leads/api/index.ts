import api from '@lib/api-client';

const LEAD_OTP_PURPOSE = 'LEAD_CAPTURE';

export const hostelLeadsApi = {
  sendLeadOtp: async (phone: string) => {
    const response = await api.post('/auth/send-phone-otp', { phone, purpose: LEAD_OTP_PURPOSE });
    return response.data as { success: boolean; expires_in_seconds: number };
  },
  verifyLeadOtp: async (phone: string, otp: string) => {
    const response = await api.post('/auth/verify-phone-otp', { phone, otp, purpose: LEAD_OTP_PURPOSE });
    return response.data as { success: boolean; phone_verified: boolean };
  },
  submitLead: async (data: { name: string; hostel_name: string; phone: string; google_email?: string }) => {
    const response = await api.post('/leads/self-serve', data);
    return response.data as { success: boolean; id: string; status: string };
  },
  getInvitationContext: async (token: string) => {
    const response = await api.get(`/leads/invitation/${token}`);
    return response.data as { name: string; hostel_name: string; phone: string; google_email: string | null; city: string | null };
  },
  completeInvitation: async (token: string) => {
    const response = await api.post(`/leads/invitation/${token}/complete`);
    return response.data;
  },
};
