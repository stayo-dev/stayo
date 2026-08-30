/**
 * The tenant's guided journey, as data.
 *
 * A tenant's portal is the inverse of a new owner's dashboard. The owner
 * signs up to a screen of zeros, which is why they got a checklist rather
 * than a tour (see `features/owner-dashboard/getting-started/gettingStarted.ts`
 * and ADR-067) — a spotlight over ₹0 cards points at things that do nothing.
 * A tenant's very first screen is already full: rent is owed, a room exists,
 * roommates exist, today's meals are on it. So there is something true to
 * point at from the first minute, and the question is not *what to fill in*
 * but *what all of this is*.
 *
 * The journey is therefore **progressive, not a single sitting**: one short
 * welcome on Home, then one hint per tab as the tenant first arrives there.
 * Nothing is a wizard, nothing blocks, and no screen is taught before it is
 * opened. A sequential cross-tab tour was rejected — it is a multi-minute
 * modal wall thrown in front of someone who opened the app to pay rent.
 *
 * PURE — no React, no storage, no DOM. Runs under vitest's node environment.
 */

/** One teachable moment, seen at most once per tenant. Beats are independent. */
export type GuideBeat = 'welcome' | 'room' | 'food' | 'money';

/** The stops of the Home welcome, in the order they are shown. */
export type WelcomeStopId = 'rent' | 'header' | 'nav';

const KEY_PREFIX = 'stayo_tenant_guide';

/**
 * Where a beat's "seen" flag lives, scoped to **one tenant and one beat**.
 *
 * The scoping is the single most important line in this feature. The owner
 * side shipped a browser-global onboarding key with no owner id in it, and
 * the one-way flag it held meant that once any owner on a device finished
 * setting up, every account signed in afterwards — brand-new ones included —
 * was permanently denied its guidance. That removed the app's only route to
 * creating a hostel. See ADR-139.
 *
 * Returns `null` rather than falling back to an "anonymous" key when there is
 * no tenant. A shared fallback key is the same bug wearing a different name:
 * it would let one person's dismissal silence the journey for the next person
 * to sign in on the same phone — which, in a hostel, is a realistic thing to
 * happen on a shared or handed-down device. No tenant, no key, no guidance.
 */
export function guideKey(beat: GuideBeat, tenantId: string | null | undefined): string | null {
  const id = tenantId?.trim();
  if (!id) return null;
  return `${KEY_PREFIX}:${beat}:${id}`;
}

/**
 * The stops of the Home welcome, led by the money when money is owed.
 *
 * Leading with rent is deliberate. A tenant opening the app to a months-old
 * overdue balance did not come for a tour, so the tour's first stop is the
 * thing they came for — what is owed and the button that settles it. It earns
 * the interruption instead of standing in front of it.
 *
 * When nothing is owed the rent stop is **dropped, not reordered**, because
 * `TenantHomePage` renders that card only while `amountDue > 0`. `Spotlight`
 * would filter the empty ref out on its own and say nothing about it — which
 * is exactly how the owner tour came to render two stops instead of three
 * without anyone noticing for weeks (ADR-139). Deciding it here makes it a
 * tested rule rather than a silent side effect.
 */
export function welcomeStops({ hasAmountDue }: { hasAmountDue: boolean }): WelcomeStopId[] {
  return hasAmountDue ? ['rent', 'header', 'nav'] : ['header', 'nav'];
}

export interface BeatVisibility {
  /** Scopes the beat. Absent means there is nobody to remember it for. */
  tenantId: string | null | undefined;
  /** This beat's flag is already stored for this tenant. */
  seen: boolean;
  /** The screen has finished loading — never anchor a tour to a skeleton. */
  ready: boolean;
  /** The tenancy has ended and the dashboard is read-only (ADR-122). */
  readOnly: boolean;
}

/**
 * Whether a beat runs now.
 *
 * `ready` matters more than it looks: every tenant tab renders a skeleton
 * first, and a spotlight armed against a skeleton finds no anchors and
 * silently drops every stop.
 *
 * `readOnly` is a deliberate exclusion. Someone whose move-out has started
 * and whose settlement is still open keeps their pages, but every action in
 * them is disabled — introducing them to features they can no longer use
 * would be the app failing to read the room.
 */
export function shouldShowBeat({ tenantId, seen, ready, readOnly }: BeatVisibility): boolean {
  if (!tenantId?.trim()) return false;
  if (!ready || readOnly) return false;
  return !seen;
}
