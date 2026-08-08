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

  /**
   * Password recovery. `delivery_degraded` reports that this deployment
   * cannot actually send email (no provider key, or the provider's sandbox
   * sender, which only reaches the account owner) — it is derived from
   * configuration alone, never from whether the address has an account, so
   * it says nothing about the email that was submitted.
   */
  forgotPasswordByEmail: async (email: string) => {
    const response = await api.post('/auth/forgot-password', { email });
    return response.data as { success: boolean; message: string; delivery_degraded?: boolean };
  },

  /**
   * Rejects with 404 `NO_ACCOUNT_FOR_PHONE` when no active account uses the
   * number, so the caller can correct a typo instead of waiting for a code
   * that was never sent. Resolves only once a code is genuinely on its way.
   */
  forgotPasswordByPhone: async (phone: string) => {
    const response = await api.post('/auth/forgot-password/phone', { phone });
    return response.data as { success: boolean; message: string; account_exists: true };
  },

  /** Exchanges a verified WhatsApp code for a short-lived token accepted by /auth/reset-password. */
  verifyResetOtp: async (phone: string, otp: string) => {
    const response = await api.post('/auth/verify-reset-otp', { phone, otp });
    return response.data as { success: boolean; reset_token: string; expires_in: number };
  },

  resetPassword: async (accessToken: string, newPassword: string) => {
    const response = await api.post('/auth/reset-password', {
      access_token: accessToken,
      new_password: newPassword,
      confirm_password: newPassword,
    });
    return response.data as { success: boolean; message?: string };
  },
};
