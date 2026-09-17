import api from '@lib/api-client';
import type { GuardianVerificationState } from '../guardianVerification';

/**
 * Guardian verification for a tenant who is already inside the app (ADR-212).
 *
 * The onboarding equivalents are token-scoped and live on `tenantService` —
 * mid-activation there is no session to authenticate with. These are the same
 * actions for someone who has one.
 */

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export interface GuardianVerificationStatus {
  state: GuardianVerificationState;
  deadline_at: string | null;
  chased: boolean;
  guardian_name: string | null;
  /** Last four digits only — enough to recognise, not enough to restate. */
  guardian_phone_hint: string | null;
  /** Whether the wall is due on this entry, after the back-off rule. */
  show_wall: boolean;
}

export const guardianVerificationApi = {
  status: async (): Promise<GuardianVerificationStatus> =>
    unwrap(await api.get('/tenants/me/guardian-verification')),

  /**
   * Ask the guardian to confirm with one tap.
   *
   * `guardianPhone` is the number the caller believes it is messaging; the
   * backend refuses to send if it does not match the tenancy's own record,
   * because the template names this resident to someone who may never have
   * heard of Stayo. Post-onboarding the two effectively always agree, so it is
   * optional here — the guard matters most on the activation screen.
   */
  requestConfirmation: async (guardianPhone?: string): Promise<{ sent: boolean; fallback_to_otp: boolean }> =>
    unwrap(await api.post('/tenants/me/guardian-verification/request', { guardian_phone: guardianPhone })),

  /** "Not now" on the wall. Counted so the wall can back off. */
  dismiss: async (): Promise<{ dismissed: boolean }> =>
    unwrap(await api.post('/tenants/me/guardian-verification/dismiss')),
};
