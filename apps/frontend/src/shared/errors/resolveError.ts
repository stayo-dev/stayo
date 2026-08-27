/**
 * Turns a failure into something a person can act on.
 *
 * Every error surface in the app used to read the same way:
 *
 *   error?.response?.data?.error?.message || 'Could not save this'
 *
 * — one sentence, in a toast, written 137 times over. It says *what failed*
 * and never *why* or *what to do next*, and because each call site invents its
 * own fallback the wording drifts and the backend's `code` is thrown away. The
 * code is the one machine-readable thing in the payload; this module is what
 * finally reads it.
 *
 * Three rules hold the design together:
 *
 *  1. **Severity picks the vessel.** Guidance shown in a toast that vanishes in
 *     2.4 seconds is not guidance, so anything carrying a next step is routed
 *     somewhere it persists. `severity` is the routing decision, made once here
 *     rather than at every call site.
 *  2. **Copy is UI, codes are data.** The backend emits `code` + `metadata` and
 *     no prose. Sentences live here, next to what renders them.
 *  3. **The unknown case still guides.** A code with no entry still gets
 *     something to try and always shows the code itself — "Something went
 *     wrong" tells a user nothing and tells support less.
 */

export type ErrorSeverity =
  /** Nothing to decide; the app recovered or the user can simply retry. */
  | 'recoverable'
  /** There is a next step, and the user has to see it. */
  | 'needs-step'
  /** The user cannot continue until they act. */
  | 'blocking';

/**
 * What the resolved error offers to do about itself. The intent is a symbol,
 * not a handler — the surface that renders it decides what it means, so this
 * module stays free of navigation and mutations.
 */
export type ErrorActionIntent =
  | 'RETRY'
  | 'SIGN_IN'
  | 'CONFIRM_PASSWORD'
  | 'CHECK_CONNECTION'
  | 'CONTACT_SUPPORT'
  | 'GO_BACK';

export interface ResolvedError {
  /** What happened, in the user's language. Never an internal code. */
  title: string;
  /** Why it happened. Empty when we genuinely do not know — never invented. */
  why: string;
  /** What to do now. Always present. */
  nextStep: string;
  severity: ErrorSeverity;
  action?: { label: string; intent: ErrorActionIntent };
  /** Always surfaced, so a user reporting this gives support something real. */
  code: string;
  /** HTTP status when there was one — useful in bug reports. */
  status?: number;
}

/** Where the failure happened, so a generic code can still say something useful. */
export type ErrorContext =
  | 'auth'
  | 'invite-tenant'
  | 'activation'
  | 'claim'
  | 'payment'
  | 'hostel-setup'
  | 'admin'
  | 'generic';

interface CatalogueEntry {
  title: string;
  why?: string;
  nextStep: string;
  severity: ErrorSeverity;
  action?: { label: string; intent: ErrorActionIntent };
}

// ── Extraction ─────────────────────────────────────────────────────────────

interface ExtractedError {
  code: string;
  message: string;
  status?: number;
  metadata: Record<string, unknown>;
  isNetwork: boolean;
}

/**
 * Pull what we can out of whatever was thrown.
 *
 * Deliberately total: an axios rejection, a bare `Error`, a string, `null` —
 * all resolve to something renderable. An error surface that itself throws is
 * the worst possible failure mode.
 */
export function extractError(error: unknown): ExtractedError {
  const any = error as any;
  const response = any?.response;
  const payload = response?.data?.error ?? response?.data;

  // Axios sets no `response` when the request never reached the server. That
  // is a materially different situation from a server rejection and gets its
  // own guidance rather than a generic failure.
  const isNetwork = Boolean(any?.isAxiosError && !response) || any?.code === 'ERR_NETWORK';

  return {
    code: String(payload?.code ?? (isNetwork ? 'NETWORK_ERROR' : '')).toUpperCase(),
    message: String(payload?.message ?? any?.message ?? (typeof error === 'string' ? error : '')).trim(),
    status: typeof response?.status === 'number' ? response.status : undefined,
    metadata:
      payload?.metadata && typeof payload.metadata === 'object' ? (payload.metadata as Record<string, unknown>) : {},
    isNetwork,
  };
}

// ── Catalogue ──────────────────────────────────────────────────────────────

const CATALOGUE: Record<string, CatalogueEntry> = {
  NETWORK_ERROR: {
    title: "Couldn't reach Stayo",
    why: 'Your device is offline, or the connection dropped mid-request.',
    nextStep: 'Check your connection and try again — nothing was saved.',
    severity: 'needs-step',
    action: { label: 'Try again', intent: 'RETRY' },
  },

  // ── Auth ────────────────────────────────────────────────────────────────
  UNAUTHORIZED: {
    title: 'Your session has ended',
    why: 'You were signed out, either by the 30-minute idle timeout or from another device.',
    nextStep: 'Sign in again to pick up where you left off.',
    severity: 'blocking',
    action: { label: 'Sign in', intent: 'SIGN_IN' },
  },
  SESSION_INACTIVE: {
    title: 'Signed out after inactivity',
    why: 'Stayo signs you out after 30 minutes without activity, to protect your data.',
    nextStep: 'Sign in again — your work is saved.',
    severity: 'blocking',
    action: { label: 'Sign in', intent: 'SIGN_IN' },
  },
  IDENTITY_REQUIRED: {
    title: 'Confirm your password first',
    why: 'This action changes money or account settings, so Stayo asks for your password again.',
    nextStep: 'Enter your password to continue.',
    severity: 'needs-step',
    action: { label: 'Confirm password', intent: 'CONFIRM_PASSWORD' },
  },
  IDENTITY_EXPIRED: {
    title: 'That confirmation expired',
    why: 'Password confirmations are valid for two minutes.',
    nextStep: 'Enter your password again to continue.',
    severity: 'needs-step',
    action: { label: 'Confirm password', intent: 'CONFIRM_PASSWORD' },
  },

  // ── OTP / delivery ──────────────────────────────────────────────────────
  OTP_SEND_FAILED: {
    title: "Couldn't send the code",
    why: 'WhatsApp would not deliver a message to that number.',
    nextStep: 'Check the number is on WhatsApp, then try again.',
    severity: 'needs-step',
    action: { label: 'Try again', intent: 'RETRY' },
  },
  OTP_INVALID: {
    title: 'That code is not right',
    why: 'The code was mistyped, or a newer one has since been sent.',
    nextStep: 'Check the latest message and enter that code.',
    severity: 'needs-step',
  },
  OTP_EXPIRED: {
    title: 'That code has expired',
    why: 'Codes are valid for five minutes.',
    nextStep: 'Request a new one.',
    severity: 'needs-step',
    action: { label: 'Send a new code', intent: 'RETRY' },
  },
  PHONE_NOT_VERIFIED: {
    title: 'Phone not verified yet',
    why: 'This step needs a verified mobile number.',
    nextStep: 'Verify the number, then try again.',
    severity: 'needs-step',
  },

  // ── Rate limiting ───────────────────────────────────────────────────────
  TOO_MANY_REQUESTS: {
    title: 'Too many attempts',
    why: 'Stayo limits how often this can be tried, to keep accounts safe.',
    nextStep: 'Wait a minute, then try again.',
    severity: 'needs-step',
  },
  RATE_LIMIT: {
    title: 'Too many attempts',
    why: 'Stayo limits how often this can be tried, to keep accounts safe.',
    nextStep: 'Wait a minute, then try again.',
    severity: 'needs-step',
  },

  // ── Domain ──────────────────────────────────────────────────────────────
  ALREADY_EXISTS: {
    title: 'That already exists',
    nextStep: 'Use a different name, or open the existing one.',
    severity: 'needs-step',
  },
  CONFLICT: {
    title: 'That already exists',
    nextStep: 'Use a different name, or open the existing one.',
    severity: 'needs-step',
  },
  HOSTEL_CONTEXT_REQUIRED: {
    title: 'No hostel selected',
    why: "This screen needs to know which hostel you're working in.",
    nextStep: 'Pick a hostel and try again.',
    severity: 'needs-step',
    action: { label: 'Go back', intent: 'GO_BACK' },
  },
  TENANT_HAS_ACTIVE_TENANCY: {
    title: 'This tenant is already staying somewhere',
    why: 'A tenant can only hold one active tenancy at a time.',
    nextStep: 'Check them out of the current room first, then invite them again.',
    severity: 'needs-step',
  },
  PLAN_LIMIT: {
    title: 'Your plan does not cover this',
    nextStep: 'Upgrade your plan, or remove something to make room.',
    severity: 'needs-step',
  },
};

/**
 * Generic codes carry no meaning on their own — `FORBIDDEN` is emitted 334
 * times across the backend and `VALIDATION_ERROR` 240. Rather than a sweep to
 * make every one of those specific, the surface tells us which flow it was in,
 * which is enough to say something true and useful.
 */
const BY_CONTEXT: Partial<Record<ErrorContext, Record<string, CatalogueEntry>>> = {
  'invite-tenant': {
    VALIDATION_ERROR: {
      title: "That invitation can't be sent yet",
      why: 'Something in the tenant or stay details is missing or invalid.',
      nextStep: 'Check the phone number, room and rent, then try again.',
      severity: 'needs-step',
    },
    FORBIDDEN: {
      title: "You can't invite to that room",
      why: 'The room belongs to a hostel on another account, or is no longer available.',
      nextStep: 'Pick a different room.',
      severity: 'needs-step',
    },
  },
  payment: {
    VALIDATION_ERROR: {
      title: "That payment can't be recorded",
      why: 'The amount or the selected dues do not add up.',
      nextStep: 'Check the amount against what is outstanding, then try again.',
      severity: 'needs-step',
    },
    FORBIDDEN: {
      title: "You can't record that payment",
      why: 'The tenant belongs to another account, or the hostel is inactive.',
      nextStep: 'Reopen the tenant from your own list and try again.',
      severity: 'needs-step',
    },
  },
  'hostel-setup': {
    VALIDATION_ERROR: {
      title: "That can't be saved yet",
      why: 'A room number, sharing size or rent is missing or out of range.',
      nextStep: 'Check the highlighted rooms, then save again.',
      severity: 'needs-step',
    },
  },
  auth: {
    VALIDATION_ERROR: {
      title: 'Check those details',
      why: 'The email or password does not look right.',
      nextStep: 'Correct them and try again.',
      severity: 'needs-step',
    },
  },
  // Claiming a tenancy an owner has been keeping records for
  // (`platforms/tenant/claim/ClaimTenancyPage.tsx`) — see the plan's error
  // list in docs/superpowers/plans/2026-08-27-owner-managed-tenants-phase-2.md
  // Task 4. `OTP_SEND_FAILED`/`OTP_EXPIRED`/`OTP_INVALID` fall through to the
  // shared catalogue above, which already covers them.
  claim: {
    OTP_PROOF_REQUIRED: {
      title: 'Your verification expired',
      why: 'A verified code is only good for a short window, and it has passed — or it was already used by an earlier attempt.',
      nextStep: 'Request a new code and verify it again.',
      severity: 'needs-step',
      action: { label: 'Send a new code', intent: 'RETRY' },
    },
    NOT_CLAIMABLE: {
      title: "That tenancy can't be claimed",
      why: 'It may already be claimed, cancelled, or no longer managed directly by the owner.',
      nextStep: 'Choose a different one if there is another, or check the number.',
      severity: 'needs-step',
    },
    ROLE_MISMATCH: {
      title: 'That number belongs to a different kind of account',
      why: "This phone number is already linked to a Stayo account that isn't a tenant account.",
      nextStep: 'Contact support for help linking it.',
      severity: 'blocking',
      action: { label: 'Contact support', intent: 'CONTACT_SUPPORT' },
    },
    VALIDATION_ERROR: {
      title: "That can't be submitted yet",
      why: 'Something in the form is missing or not filled in correctly.',
      nextStep: 'Check the highlighted fields and try again.',
      severity: 'needs-step',
    },
    RATE_LIMITED: {
      title: 'Too many attempts',
      why: 'Stayo limits how often this can be tried, to keep accounts safe.',
      nextStep: 'Wait a few minutes, then try again.',
      severity: 'needs-step',
    },
    SIGN_IN_REQUIRED: {
      title: 'You already have an account with this number',
      why: 'This phone number is linked to a Stayo account that already has a password, so Stayo will not reset it for you.',
      nextStep: 'Sign in to that account, then claim this tenancy from there.',
      severity: 'blocking',
      action: { label: 'Sign in', intent: 'SIGN_IN' },
    },
  },
};

const BY_STATUS: Record<number, CatalogueEntry> = {
  403: {
    title: "You don't have access to that",
    why: 'It belongs to another account, or your role does not allow it.',
    nextStep: 'If you think this is wrong, contact support with the code below.',
    severity: 'needs-step',
    action: { label: 'Contact support', intent: 'CONTACT_SUPPORT' },
  },
  404: {
    title: "That doesn't exist any more",
    why: 'It was deleted, or the link is out of date.',
    nextStep: 'Go back and open it from the list.',
    severity: 'needs-step',
    action: { label: 'Go back', intent: 'GO_BACK' },
  },
  500: {
    title: 'Something broke on our side',
    why: 'This is a fault in Stayo, not anything you did.',
    nextStep: 'Try again in a moment. If it keeps happening, send support the code below.',
    severity: 'needs-step',
    action: { label: 'Try again', intent: 'RETRY' },
  },
  502: {
    title: 'Stayo is having trouble right now',
    why: 'A service Stayo depends on is not responding.',
    nextStep: 'Try again in a minute.',
    severity: 'needs-step',
    action: { label: 'Try again', intent: 'RETRY' },
  },
};

/**
 * Fill `{placeholders}` from the error's metadata.
 *
 * This is what makes guidance specific — "Room 101 already exists" instead of
 * "That already exists" — without the backend having to carry any prose. A
 * placeholder with no matching metadata is dropped rather than shown raw.
 */
export function interpolate(text: string, metadata: Record<string, unknown>): string {
  return text
    .replace(/\{(\w+)\}/g, (_, key) => {
      const value = metadata[key];
      return value === undefined || value === null ? '' : String(value);
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function resolveError(error: unknown, context: ErrorContext = 'generic'): ResolvedError {
  const extracted = extractError(error);

  const entry =
    (context !== 'generic' ? BY_CONTEXT[context]?.[extracted.code] : undefined) ??
    CATALOGUE[extracted.code] ??
    (extracted.status ? BY_STATUS[extracted.status] : undefined);

  if (entry) {
    return {
      title: interpolate(entry.title, extracted.metadata),
      why: interpolate(entry.why ?? '', extracted.metadata),
      nextStep: interpolate(entry.nextStep, extracted.metadata),
      severity: entry.severity,
      action: entry.action,
      code: extracted.code || 'ERROR',
      status: extracted.status,
    };
  }

  // Nothing matched. The server's own message is still the best description we
  // have, so it becomes the title rather than being discarded in favour of a
  // generic line — but it never becomes the *guidance*, because backend
  // messages are written for developers.
  return {
    title: extracted.message || 'That did not work',
    why: '',
    nextStep: 'Try again. If it keeps happening, send support the code below.',
    severity: 'needs-step',
    action: { label: 'Try again', intent: 'RETRY' },
    code: extracted.code || 'ERROR',
    status: extracted.status,
  };
}

/** One line, for the places that genuinely only have room for one. */
export function toErrorLine(resolved: ResolvedError): string {
  return resolved.why ? `${resolved.title} — ${resolved.nextStep}` : `${resolved.title}. ${resolved.nextStep}`;
}
