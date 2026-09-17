import api from '@lib/api-client';

/**
 * Public, token-gated manager-activation endpoints
 * (`/api/managers/invitation/[token]/*`) — no session, mirrors
 * `hostel-leads/api`'s activation shape. Unlike the owner activation flow,
 * completing this does NOT return Supabase tokens: the backend only sets the
 * manager's password, and their first real sign-in goes through the normal
 * `/api/auth/login` path (JIT Supabase-account linking happens there, same
 * as every other role) — see manager-invitation-service.ts.
 */
export const managerInvitationApi = {
  getInvitationContext: async (token: string) => {
    const response = await api.get(`/managers/invitation/${token}`);
    return response.data as { name: string; phone: string; email: string; phoneVerified: boolean };
  },
  sendPhoneOtp: async (token: string) => {
    const response = await api.post(`/managers/invitation/${token}/send-otp`);
    return response.data as { success: boolean; verification_required: boolean };
  },
  verifyPhoneOtp: async (token: string, otp: string) => {
    const response = await api.post(`/managers/invitation/${token}/verify-otp`, { otp });
    return response.data as { verified: boolean };
  },
  activate: async (token: string, password: string) => {
    const response = await api.post(`/managers/invitation/${token}/activate`, { password });
    return response.data as { activated: boolean; email: string };
  },
};
