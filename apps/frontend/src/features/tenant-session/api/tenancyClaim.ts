import api from '@lib/api-client';
import type { Acknowledgements, ClaimConfirmResult, ClaimTenancy } from '@platforms/tenant/claim/claimSteps';

/**
 * API wrapper for the tenant-facing tenancy-claim flow
 * (`docs/superpowers/plans/2026-08-27-owner-managed-tenants-phase-2.md`
 * Task 4). The only layer that knows these endpoint shapes — everything
 * else (the pure step machine, the page) goes through this.
 *
 * Uses the default (identity-aware) `api` client, not `publicApi`, for two
 * reasons: (1) `sendPhoneOtp`/`verifyPhoneOtp` are the same generic
 * endpoints `tenantService` already calls for activation, just with
 * `purpose: "TENANCY_CLAIM"`; (2) `POST /tenancy-claim/confirm` is
 * identity-*optional* on the backend (`IDENTITY_OPTIONAL_UNDER_PUBLIC` in
 * `apps/backend/lib/auth/public-route-exceptions.ts`) — a signed-in
 * tenant's session must be sent so the backend can attach the claim to
 * their existing profile instead of minting a new one; `api` attaches the
 * bearer token automatically when one exists and simply omits it when it
 * doesn't, which covers both callers with one client.
 *
 * CSRF: `api-client.ts`'s `isPublicAuthRequest` allow-list (which skips the
 * CSRF dance entirely) does NOT include any `/tenancy-claim/*` path, so
 * `ensureCsrfToken()`/`attachCsrfHeader()` run for every call here exactly
 * as they do for any other authenticated POST. That matters specifically
 * for `confirm`: the backend's `middleware.ts` only enforces the CSRF gate
 * once a session is present (an anonymous caller is routed to
 * `asAnonymous()` before the CSRF check ever runs — see
 * `public-route-exceptions.ts`'s module comment) — so a signed-in tenant
 * claiming a second tenancy genuinely needs the header sent, and this
 * client sends it.
 */

const CLAIM_OTP_PURPOSE = 'TENANCY_CLAIM';

const unwrap = (response: { data: any }) =>
  response.data?.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;

export const tenancyClaimApi = {
  sendOtp: async (phone: string): Promise<{ verification_required: boolean }> => {
    const response = await api.post('/auth/send-phone-otp', { phone, purpose: CLAIM_OTP_PURPOSE });
    return unwrap(response);
  },

  verifyOtp: async (phone: string, otp: string): Promise<void> => {
    await api.post('/auth/verify-phone-otp', { phone, otp, purpose: CLAIM_OTP_PURPOSE });
  },

  lookup: async (phone: string): Promise<ClaimTenancy[]> => {
    const response = await api.post('/tenancy-claim/lookup', { phone });
    const data = unwrap(response);
    return Array.isArray(data?.tenancies) ? data.tenancies : [];
  },

  confirm: async (input: {
    phone: string;
    tenantId: string;
    acknowledgements: Acknowledgements;
    typedSignatureName: string;
    name?: string;
    email?: string;
    /**
     * Omitted entirely for an already-signed-in caller — the backend
     * (`tenancy-claim-service.ts` `confirm`) refuses one from them, since
     * their session already authenticates them. Required for everyone else;
     * `ClaimTenancyPage` gates the button on `canConfirm`/`passwordReady`
     * before this is ever called.
     */
    password?: string;
  }): Promise<ClaimConfirmResult> => {
    const response = await api.post('/tenancy-claim/confirm', {
      phone: input.phone,
      tenant_id: input.tenantId,
      acknowledgements: input.acknowledgements,
      typed_signature_name: input.typedSignatureName,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.email?.trim() ? { email: input.email.trim() } : {}),
      ...(input.password ? { password: input.password, confirm_password: input.password } : {}),
    });
    return unwrap(response);
  },
};
