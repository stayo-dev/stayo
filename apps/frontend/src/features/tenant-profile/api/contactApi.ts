import api from '@lib/api-client';

/**
 * Proving a contact detail you are changing to.
 *
 * The mirror of `authApi`'s phone OTP pair, for email. `verification_required:
 * false` means no code is coming — Resend or Redis is not configured — and the
 * caller should save the change rather than wait for one, the same contract
 * the WhatsApp leg has had since ADR-034.
 */
export const contactApi = {
  startEmailVerification: async (email: string) => {
    const response = await api.post('/profile/contact/email/start', { email });
    const body = response.data?.data ?? response.data ?? {};
    return body as { success: boolean; verification_required: boolean; reason?: string };
  },

  confirmEmailVerification: async (email: string, code: string) => {
    const response = await api.post('/profile/contact/email/confirm', { email, code });
    return (response.data?.data ?? response.data) as { verified: boolean };
  },
};
