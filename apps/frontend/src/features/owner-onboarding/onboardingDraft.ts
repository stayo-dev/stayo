import type { OwnerOnboardingData } from './hooks/useOwnerOnboardingState';

/**
 * Draft persistence for the owner onboarding wizard.
 *
 * The wizard previously held everything in `useState`, so closing the tab
 * anywhere across eight steps threw away every answer — reported as bad UX,
 * and it is.
 *
 * localStorage rather than a server draft, deliberately: step 1 *creates* the
 * account, so for the first step there is no row on the server to save
 * against. Local covers the loss that actually happens (reload, tab close,
 * browser restart on the same device). Switching device mid-onboarding still
 * loses it — an accepted limitation, not an oversight.
 *
 * Pure: serialization and validation live here so they are testable in the
 * node-only environment, and so the password-exclusion rule below is enforced
 * in one place rather than trusted to every caller.
 */

export const ONBOARDING_DRAFT_KEY = 'stayo.ownerOnboarding.draft';

/** Bump when `OwnerOnboardingData`'s shape changes; older drafts are discarded. */
export const DRAFT_SCHEMA_VERSION = 1;

/** The wizard has 8 steps; a restored index outside this is meaningless. */
const MAX_STEP = 8;

export type OnboardingDraft = {
  version: number;
  step: number;
  data: OwnerOnboardingData;
  savedAt: number;
};

export type DraftInput = {
  step: number;
  data: OwnerOnboardingData;
};

/**
 * Serialize for storage.
 *
 * Takes an explicit allowlist of fields rather than spreading whatever it is
 * given: a password must never reach localStorage, where it would sit in plain
 * text long after the session ends. Callers can pass a wider object safely.
 */
export function serializeDraft(input: DraftInput): string {
  const d = input.data;
  return JSON.stringify({
    version: DRAFT_SCHEMA_VERSION,
    step: input.step,
    savedAt: Date.now(),
    data: {
      name: d.name,
      mobile: d.mobile,
      email: d.email,
      hostelName: d.hostelName,
      type: d.type,
      address: d.address,
      city: d.city,
      floors: d.floors,
      capacity: d.capacity,
      food: d.food,
      deposit: d.deposit,
      depositMode: d.depositMode,
      depositMonths: d.depositMonths,
      monthlyRent: d.monthlyRent,
      roomsPerFloor: d.roomsPerFloor,
      bedsPerRoom: d.bedsPerRoom,
    },
  });
}

/** Parse a stored draft, returning null for anything unusable. */
export function parseDraft(raw: string | null): OnboardingDraft | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt or hand-edited storage must not white-screen the wizard.
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidate = parsed as Partial<OnboardingDraft>;

  if (candidate.version !== DRAFT_SCHEMA_VERSION) return null;
  if (!candidate.data || typeof candidate.data !== 'object' || Array.isArray(candidate.data)) return null;

  const step = Number(candidate.step);
  return {
    version: DRAFT_SCHEMA_VERSION,
    step: Number.isFinite(step) ? Math.min(MAX_STEP, Math.max(0, Math.trunc(step))) : 0,
    data: candidate.data as OwnerOnboardingData,
    savedAt: Number.isFinite(Number(candidate.savedAt)) ? Number(candidate.savedAt) : 0,
  };
}

/**
 * Is this draft worth offering to restore?
 *
 * Restoring someone onto an empty first step is not resuming anything, and the
 * "picking up where you left off" banner would be a lie.
 */
export function isDraftResumable(draft: OnboardingDraft | null): boolean {
  if (!draft) return false;
  if (draft.step > 0) return true;

  const d = draft.data;
  return Boolean(
    String(d?.name || '').trim() ||
      String(d?.hostelName || '').trim() ||
      String(d?.city || '').trim() ||
      String(d?.address || '').trim(),
  );
}

/**
 * Storage wrappers. Every localStorage access is guarded: Safari private mode
 * and blocked third-party storage both throw on access, and losing a draft is
 * strictly better than crashing the wizard someone is halfway through.
 */
export function readStoredDraft(): OnboardingDraft | null {
  try {
    return parseDraft(window.localStorage.getItem(ONBOARDING_DRAFT_KEY));
  } catch {
    return null;
  }
}

export function writeStoredDraft(input: DraftInput): void {
  try {
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY, serializeDraft(input));
  } catch {
    // Storage full or blocked — the wizard still works, it just won't resume.
  }
}

export function clearStoredDraft(): void {
  try {
    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    // Nothing to do; a stale draft is discarded by version or by isDraftResumable.
  }
}
