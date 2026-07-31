import api from '@lib/api-client';

/**
 * Auth endpoints used by surfaces that can't reach a feature API wrapper —
 * `shared/ui-patterns/LoginModal` in particular, since shared code may not
 * import `@features/*` (scripts/check-architecture.mjs). Session-minting
 * calls (login, tenant signup) live on AuthContext instead, because they
 * also have to hydrate the session.
 *
 * `verification_required: false` means WhatsApp could not deliver a code and
 * the backend recorded the number as unverified — callers must skip their
 * OTP step rather than wait for a code that will never arrive (ADR-034).
 */
export const authApi = {
  sendPhoneOtp: async (phone: string) => {
    const response = await api.post('/auth/send-phone-otp', { phone });
    return response.data as {
      success: boolean;
      verification_required: boolean;
      expires_in_seconds?: number;
      reason?: string;
    };
  },

  verifyPhoneOtp: async (phone: string, otp: string) => {
    const response = await api.post('/auth/verify-phone-otp', { phone, otp });
    return response.data as { success: boolean; phone_verified: boolean };
  },
};
