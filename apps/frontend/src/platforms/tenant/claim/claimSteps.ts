import { canonicalPhone } from '@shared/lib/phone';

/**
 * Pure step machine for the tenant-facing tenancy-claim flow
 * (`docs/superpowers/plans/2026-08-27-owner-managed-tenants-phase-2.md`
 * Task 4). `ClaimTenancyPage.tsx` is a thin renderer over this module: every
 * branch decision — which step is current, what may advance it, which
 * errors send the tenant back a step — lives here and is tested here, per
 * `vitest.config.ts`'s node-only harness (no jsdom, no `.test.tsx`).
 *
 * Flow: phone -> otp -> (picker if >1 match) -> confirm -> done. An empty
 * lookup (`tenancies.length === 0`) is a normal outcome, not an error, and
 * gets its own terminal-ish step rather than being folded into an error
 * state.
 *
 * Backend contract (already built, Tasks 1-3 of this plan):
 *  - `POST /auth/send-phone-otp` / `verify-phone-otp` with
 *    `purpose: "TENANCY_CLAIM"` — `verify-phone-otp` returns a `claim_token`
 *    (SECURITY, final security review finding 1) that must be presented to
 *    both endpoints below; stored in `state.claimToken`.
 *  - `POST /tenancy-claim/lookup` -> `{ tenancies: ClaimTenancy[] }`.
 *  - `POST /tenancy-claim/confirm` -> a `ClaimTenancy` plus `profile_id` /
 *    `access_mode`.
 *  - The claim proof is single-use and expires 10 minutes after
 *    verification (`CLAIM_PROOF_MAX_AGE_MS` in
 *    `apps/backend/lib/tenants/claim-eligibility.ts`) — `OTP_PROOF_REQUIRED`
 *    can surface from *either* `lookup` or `confirm`, and the only recovery
 *    is a fresh code, never a re-verify of the old one. See
 *    `applyClaimError` below for why that always routes back to the phone
 *    step rather than stranding the tenant on a dead screen.
 */

export type ClaimStepName = 'phone' | 'otp' | 'empty' | 'picker' | 'confirm' | 'done';

/** Display-only shape `POST /tenancy-claim/lookup` and `.../confirm` both return — never obligations/balances. */
export interface ClaimTenancy {
  tenant_id: string;
  hostel_name: string | null;
  room_no: string | null;
  joined_on: string | null;
  owner_name: string | null;
  monthly_rent: number | null;
}

/** The subset of a Supabase session `POST /tenancy-claim/confirm` hands back when it mints one. */
export interface ClaimSessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface ClaimConfirmResult extends ClaimTenancy {
  profile_id: string;
  access_mode: string;
  /**
   * Present only when `confirm` minted a fresh session — absent for an
   * already-signed-in caller (whose existing session already authenticates
   * them, and who was never asked for a password) and, rarely, when session
   * minting failed *after* the claim itself durably committed on the backend
   * (`tenancy-claim-service.ts`'s `session_mint_failed` path). Either way the
   * claim itself succeeded; a missing `session` only changes how the tenant
   * gets signed in, never whether the claim worked.
   */
  session?: ClaimSessionTokens | null;
}

/**
 * Mirrors `REQUIRED_ACKNOWLEDGEMENTS` in
 * `apps/backend/src/services/tenants/tenancy-claim-service.ts` — kept as a
 * local copy for the same reason that file gives for not importing it:
 * this is a small, deliberately decoupled module. The two lists must be
 * changed together.
 */
export const REQUIRED_ACKNOWLEDGEMENTS = [
  'fee_refund_rules',
  'discipline_policies',
  'late_fee_obligations',
  'damage_liabilities',
  'hostel_rules',
] as const;

export type AcknowledgementKey = (typeof REQUIRED_ACKNOWLEDGEMENTS)[number];
export type Acknowledgements = Record<AcknowledgementKey, boolean>;

export function emptyAcknowledgements(): Acknowledgements {
  return {
    fee_refund_rules: false,
    discipline_policies: false,
    late_fee_obligations: false,
    damage_liabilities: false,
    hostel_rules: false,
  };
}

export interface ClaimState {
  step: ClaimStepName;
  phone: string;
  otp: string;
  /**
   * SECURITY (final security review, finding 1): the single-use token the
   * backend returns from OTP verification, which `lookup` and `confirm` both
   * now require alongside a fresh verified code — see `tenancyClaimApi`'s
   * module comment. Set once, by `VERIFY_OTP_SUCCEEDED`; cleared on
   * `RESTART` (a new phone/OTP cycle earns a new token) exactly like `otp`
   * itself is.
   */
  claimToken: string | null;
  tenancies: ClaimTenancy[];
  selectedTenantId: string | null;
  acknowledgements: Acknowledgements;
  typedSignatureName: string;
  name: string;
  email: string;
  /** Only meaningful (and only required) when `!alreadySignedIn` — see `passwordReady`. */
  password: string;
  confirmPassword: string;
  /**
   * Whether the claimant already had a live session when this flow started.
   * Set once, from `ClaimTenancyPage`'s own `useAuth()` read, via
   * `initialClaimState`'s argument — never toggled mid-flow. Mirrors the
   * backend's own rule (`tenancy-claim-service.ts` `confirm`): a
   * signed-in caller needs no password (their session already authenticates
   * them) and the backend refuses one from them; an unauthenticated
   * claimant must supply one.
   */
  alreadySignedIn: boolean;
  submitting: boolean;
  /** The most recent failure's human-readable message, or null. Cleared on every input change. */
  error: string | null;
  result: ClaimConfirmResult | null;
}

export function initialClaimState(options?: { alreadySignedIn?: boolean }): ClaimState {
  return {
    step: 'phone',
    phone: '',
    otp: '',
    claimToken: null,
    tenancies: [],
    selectedTenantId: null,
    acknowledgements: emptyAcknowledgements(),
    typedSignatureName: '',
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    alreadySignedIn: options?.alreadySignedIn ?? false,
    submitting: false,
    error: null,
    result: null,
  };
}

export type ClaimEvent =
  | { type: 'PHONE_CHANGED'; phone: string }
  | { type: 'SEND_OTP_REQUESTED' }
  | { type: 'SEND_OTP_SUCCEEDED' }
  | { type: 'SEND_OTP_FAILED'; message: string }
  | { type: 'OTP_CHANGED'; otp: string }
  | { type: 'VERIFY_OTP_REQUESTED' }
  | { type: 'VERIFY_OTP_SUCCEEDED'; claimToken: string | null }
  | { type: 'VERIFY_OTP_FAILED'; message: string }
  | { type: 'LOOKUP_REQUESTED' }
  | { type: 'LOOKUP_SUCCEEDED'; tenancies: ClaimTenancy[] }
  | { type: 'LOOKUP_FAILED'; code: string; message: string }
  | { type: 'SELECT_TENANCY'; tenantId: string }
  | { type: 'BACK_TO_PICKER' }
  | { type: 'ACK_TOGGLED'; key: AcknowledgementKey; value: boolean }
  | { type: 'FIELD_CHANGED'; field: 'typedSignatureName' | 'name' | 'email' | 'password' | 'confirmPassword'; value: string }
  | { type: 'CONFIRM_REQUESTED' }
  | { type: 'CONFIRM_SUCCEEDED'; result: ClaimConfirmResult }
  | { type: 'CONFIRM_FAILED'; code: string; message: string }
  | { type: 'RESTART' };

/**
 * What step a set of lookup-eligible tenancies lands on. Zero is the normal
 * "nothing to claim with this number" outcome; exactly one skips the picker
 * (there is nothing to choose between); more than one shows it. Shared by
 * `LOOKUP_SUCCEEDED` and the `NOT_CLAIMABLE` recovery in `applyClaimError`
 * so a claim that fails down to a single remaining candidate behaves the
 * same way a lookup that found only one would.
 */
function classifyTenancies(tenancies: ClaimTenancy[]): { step: ClaimStepName; selectedTenantId: string | null } {
  if (tenancies.length === 0) return { step: 'empty', selectedTenantId: null };
  if (tenancies.length === 1) return { step: 'confirm', selectedTenantId: tenancies[0].tenant_id };
  return { step: 'picker', selectedTenantId: null };
}

/**
 * Where a failed `lookup`/`confirm` call sends the tenant, keyed by the
 * backend's error code (see the plan's Task 4 section for the full list).
 */
function applyClaimError(state: ClaimState, code: string, message: string): ClaimState {
  if (code === 'OTP_PROOF_REQUIRED') {
    // The verified-proof window closed (10 minutes), a previous failed
    // confirm already consumed it, or the claim token no longer matches it
    // — see the module comment. There is no "re-verify the same code"
    // recovery, only "request a new one," so this always lands back on the
    // phone step with the number retained, never leaves the tenant on the
    // OTP or confirm screen waiting for nothing. `claimToken` is cleared
    // too — it's bound to the now-invalid proof, so a stale one must not
    // silently ride along into the next verify/lookup cycle.
    return { ...state, submitting: false, step: 'phone', otp: '', claimToken: null, error: message };
  }

  if (code === 'NOT_CLAIMABLE') {
    // The selected tenancy stopped being claimable between lookup and
    // confirm (e.g. the owner cancelled it, or someone else claimed it).
    // Drop it from the candidate list and re-classify what's left, rather
    // than stranding the tenant on a confirm screen for a tenancy that no
    // longer exists as an option.
    const remaining = state.tenancies.filter((t) => t.tenant_id !== state.selectedTenantId);
    const { step, selectedTenantId } = classifyTenancies(remaining);
    return { ...state, submitting: false, tenancies: remaining, selectedTenantId, step, error: message };
  }

  if (code === 'SIGN_IN_REQUIRED') {
    // SECURITY (`tenancy-claim-service.ts` `assertClaimablePhoneMatch`): the
    // phone number matched an existing account that already has a password,
    // and the backend refuses to touch it. There is no in-flow recovery —
    // supplying a different password or re-verifying the same number will
    // never change the answer. Stays put and surfaces the message (already a
    // full sentence telling them to sign in first); the page's copy can
    // point them at the login screen from there.
    return { ...state, submitting: false, error: message };
  }

  // ROLE_MISMATCH ("this number belongs to a different kind of Stayo
  // account") has no in-flow recovery — retrying the same tenancy or a
  // different acknowledgement will not change the answer, so this stays put
  // and surfaces the message; the page's copy tells them to contact
  // support. VALIDATION_ERROR and any unmapped code are genuinely
  // retryable in place (e.g. a missing acknowledgement or a bad email), so
  // they stay put too.
  return { ...state, submitting: false, error: message };
}

export function claimReducer(state: ClaimState, event: ClaimEvent): ClaimState {
  switch (event.type) {
    case 'PHONE_CHANGED':
      return { ...state, phone: event.phone, error: null };

    case 'SEND_OTP_REQUESTED':
      return { ...state, submitting: true, error: null };
    case 'SEND_OTP_SUCCEEDED':
      return { ...state, submitting: false, step: 'otp', otp: '', error: null };
    case 'SEND_OTP_FAILED':
      // Stays on 'phone' -- OTP_SEND_FAILED (WhatsApp down) is a real,
      // retryable error per the plan, never waved through as success.
      return { ...state, submitting: false, error: event.message };

    case 'OTP_CHANGED':
      return { ...state, otp: event.otp, error: null };

    case 'VERIFY_OTP_REQUESTED':
      return { ...state, submitting: true, error: null };
    case 'VERIFY_OTP_SUCCEEDED':
      // Stays on 'otp' -- the caller immediately follows this with a lookup
      // request; LOOKUP_REQUESTED/LOOKUP_SUCCEEDED own the step transition.
      return { ...state, claimToken: event.claimToken, error: null };
    case 'VERIFY_OTP_FAILED':
      return { ...state, submitting: false, error: event.message };

    case 'LOOKUP_REQUESTED':
      return { ...state, submitting: true, error: null };
    case 'LOOKUP_SUCCEEDED': {
      const { step, selectedTenantId } = classifyTenancies(event.tenancies);
      return { ...state, submitting: false, tenancies: event.tenancies, step, selectedTenantId, error: null };
    }
    case 'LOOKUP_FAILED':
      return applyClaimError(state, event.code, event.message);

    case 'SELECT_TENANCY':
      return { ...state, step: 'confirm', selectedTenantId: event.tenantId, error: null };
    case 'BACK_TO_PICKER':
      // A no-op unless there is genuinely more than one candidate to choose
      // between -- guards against a stray back action collapsing the
      // single-match auto-selection.
      return state.tenancies.length > 1 ? { ...state, step: 'picker', selectedTenantId: null, error: null } : state;

    case 'ACK_TOGGLED':
      return { ...state, acknowledgements: { ...state.acknowledgements, [event.key]: event.value } };
    case 'FIELD_CHANGED':
      return { ...state, [event.field]: event.value };

    case 'CONFIRM_REQUESTED':
      return { ...state, submitting: true, error: null };
    case 'CONFIRM_SUCCEEDED':
      return { ...state, submitting: false, step: 'done', result: event.result, error: null };
    case 'CONFIRM_FAILED':
      return applyClaimError(state, event.code, event.message);

    case 'RESTART':
      // Preserve `alreadySignedIn` across a restart -- it describes the
      // session the tenant walked in with, not anything this flow itself
      // set, so starting over must not forget it and start demanding a
      // password from someone who never needed one.
      return initialClaimState({ alreadySignedIn: state.alreadySignedIn });

    default:
      return state;
  }
}

// ── Render-time guards ──────────────────────────────────────────────────
// Pure predicates the thin renderer uses to decide what's clickable, kept
// here rather than inline in the component so they're covered by the same
// tests as the transitions they gate.

/**
 * Whether a caller who already had a live session when the claim flow
 * started should be treated as `alreadySignedIn` for this flow. SECURITY
 * (final security review, finding 4): previously `ClaimTenancyPage` used
 * `Boolean(user)` alone, so a signed-in OWNER or ADMIN also got
 * `alreadySignedIn: true` — hiding the password fields and enabling
 * "Confirm" — but the backend's `confirm` (`tenancy-claim-service.ts`) only
 * ever reads `profileId` off a session whose role is `TENANT`
 * (`app/api/tenancy-claim/confirm/route.ts`: `session.role === "TENANT" ?
 * session.sub : null`), so a non-TENANT caller's `profileId` comes through
 * as `null` there — landing them on "A password of at least 8 characters is
 * required" with no password field on screen to satisfy it, an
 * unrecoverable dead end. `AuthContext` normalizes `role` to lowercase
 * (`normalizeRole`), so this compares against `'tenant'`, not `'TENANT'`.
 */
export function isTenantSession(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === 'tenant';
}

/** A phone number must canonicalize to a full Indian mobile number before "Send code" is enabled. */
export function canSendOtp(phone: string): boolean {
  return canonicalPhone(phone) !== '';
}

/** OTPs from this backend are always a 6-digit code. */
export function canVerifyOtp(otp: string): boolean {
  return otp.trim().length === 6;
}

export function acknowledgementsComplete(acknowledgements: Acknowledgements): boolean {
  return REQUIRED_ACKNOWLEDGEMENTS.every((key) => acknowledgements[key] === true);
}

/**
 * Whether the password fields satisfy the server's own gate
 * (`tenancy-claim-service.ts` `confirm`): an already-signed-in caller needs
 * none (and the backend refuses one from them), so this is vacuously true;
 * otherwise it's the same floor as `ActivationSchema.password` (8 chars) with
 * the two fields matching.
 */
export function passwordReady(state: ClaimState): boolean {
  if (state.alreadySignedIn) return true;
  return state.password.length >= 8 && state.password === state.confirmPassword;
}

/**
 * Whether "Confirm" may be pressed. Mirrors the server's own gate
 * (`assertAcknowledgementsComplete` + the typed-signature requirement +
 * the password requirement) so the button disables before a doomed request
 * is ever sent -- the server enforcement is what actually matters, this is
 * just not making the tenant wait for a 400 to find out.
 */
export function canConfirm(state: ClaimState): boolean {
  return (
    Boolean(state.selectedTenantId) &&
    acknowledgementsComplete(state.acknowledgements) &&
    state.typedSignatureName.trim().length > 0 &&
    passwordReady(state)
  );
}

export function selectedTenancy(state: ClaimState): ClaimTenancy | null {
  return state.tenancies.find((t) => t.tenant_id === state.selectedTenantId) ?? null;
}
