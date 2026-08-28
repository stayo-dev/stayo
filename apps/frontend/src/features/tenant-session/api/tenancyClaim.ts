import api from '@lib/api-client';
import type { Acknowledgements, ClaimConfirmResult, ClaimStatement, ClaimTenancy } from '@platforms/tenant/claim/claimSteps';

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

  /**
   * SECURITY (final security review, finding 1): the backend now returns a
   * single-use `claim_token` bound to this exact OTP row when purpose is
   * `TENANCY_CLAIM` — the caller must present it, unchanged, to both
   * `lookup` and `confirm` below or they 401 with `OTP_PROOF_REQUIRED`, even
   * with an otherwise-fresh verified code. `ClaimTenancyPage` stores this in
   * `state.claimToken` (`VERIFY_OTP_SUCCEEDED`) and threads it through.
   */
  verifyOtp: async (phone: string, otp: string): Promise<{ claimToken: string | null }> => {
    const response = await api.post('/auth/verify-phone-otp', { phone, otp, purpose: CLAIM_OTP_PURPOSE });
    const data = unwrap(response);
    return { claimToken: typeof data?.claim_token === 'string' ? data.claim_token : null };
  },

  lookup: async (phone: string, claimToken: string | null): Promise<ClaimTenancy[]> => {
    const response = await api.post('/tenancy-claim/lookup', {
      phone,
      ...(claimToken ? { claim_token: claimToken } : {}),
    });
    const data = unwrap(response);
    return Array.isArray(data?.tenancies) ? data.tenancies : [];
  },

  /**
   * The pre-confirm statement of what the owner recorded (rent months,
   * payments, outstanding total) for one claimable tenancy — gated by the
   * same `claimToken` as `lookup`/`confirm`. Read-only on the backend: it
   * never consumes the OTP proof, so this can be called (or re-called,
   * while the tenant reads it) without spending what `confirm` still needs.
   */
  statement: async (phone: string, tenantId: string, claimToken: string | null): Promise<ClaimStatement> => {
    const response = await api.post('/tenancy-claim/statement', {
      phone,
      tenant_id: tenantId,
      ...(claimToken ? { claim_token: claimToken } : {}),
    });
    return unwrap(response);
  },

  confirm: async (input: {
    phone: string;
    tenantId: string;
    claimToken: string | null;
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
    /**
     * The tenant's verdict on the statement shown at the review step —
     * absent/empty on both means "this looks right." A dispute never blocks
     * the claim (`tenancy-claim-service.ts`'s own module comment); it just
     * gets recorded and the owner notified once the claim commits.
     */
    disputedItems?: string[];
    disputeNote?: string;
  }): Promise<ClaimConfirmResult> => {
    const response = await api.post('/tenancy-claim/confirm', {
      phone: input.phone,
      tenant_id: input.tenantId,
      ...(input.claimToken ? { claim_token: input.claimToken } : {}),
      acknowledgements: input.acknowledgements,
      typed_signature_name: input.typedSignatureName,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.email?.trim() ? { email: input.email.trim() } : {}),
      ...(input.password ? { password: input.password, confirm_password: input.password } : {}),
      ...(input.disputedItems?.length ? { disputed_items: input.disputedItems } : {}),
      ...(input.disputeNote?.trim() ? { dispute_note: input.disputeNote.trim() } : {}),
    });
    return unwrap(response);
  },
};
