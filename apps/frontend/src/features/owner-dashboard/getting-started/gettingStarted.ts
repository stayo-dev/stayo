/**
 * The new-owner walkthrough, derived from what the account actually contains.
 *
 * Nothing here is a stored "onboarding step". A freshly signed-up owner's
 * dashboard is entirely zeros — no rooms, no tenants, no money — so the useful
 * guidance is not a map of the UI but the short sequence that turns an empty
 * account into a working one. Each step ticks itself off when its real data
 * appears, which means the checklist stays honest across devices, refreshes,
 * and work done outside this card.
 *
 * Owner KYC is deliberately **not** a step: `owner_documents.status` is set by
 * a Stayo admin and "can only be changed by an admin", so a checklist item for
 * it could never be ticked by the person reading it. It is reported separately
 * as a status line.
 */

export type StepId = 'hostel' | 'tenant' | 'payment';
export type StepState = 'done' | 'current' | 'todo';

export interface GettingStartedStep {
  id: StepId;
  title: string;
  /** Real facts once known, guidance before that — never a fabricated number. */
  detail: string;
  /**
   * Why this step exists at all, in the owner's terms rather than the app's.
   * Present only while the step is outstanding: once it is done, the reason
   * has been demonstrated and the row should shrink back to a fact.
   */
  why: string | null;
  /** Roughly how long this takes. Absent once done. */
  duration: string | null;
  cta: string;
  state: StepState;
}

export interface GettingStartedSignals {
  /** Beds across every hostel. Zero means no rooms have been built yet. */
  roomCapacity: number;
  /** Active + invited. An invited tenant counts — the owner did the work. */
  tenantCount: number;
  /**
   * Whether the owner has *ever* recorded a payment, across every hostel.
   *
   * Deliberately a lifetime fact rather than this month's collection. The
   * monthly figure resets on the 1st, so the checklist used to need a one-way
   * `graduated` latch in browser storage to stop it telling an established
   * hostel every month that it had never taken rent — and that latch was
   * keyed globally rather than per owner, so one finished account silently
   * suppressed the checklist for every account opened afterwards in the same
   * browser, new ones included. With all three steps now permanently-true
   * facts, the latch has nothing left to do and is gone. See ADR-139.
   */
  hasEverCollected: boolean;
  /**
   * A hostel that exists but has floors with no rooms, for step one's detail.
   */
  hostelInProgress?: { name: string; summary: string } | null;
}

export interface GettingStarted {
  /** False once the owner is up and running — the card removes itself. */
  visible: boolean;
  steps: GettingStartedStep[];
  doneCount: number;
  total: number;
  percent: number;
  isComplete: boolean;
}

export function deriveGettingStarted(signals: GettingStartedSignals): GettingStarted {
  const hasRooms = signals.roomCapacity > 0;
  const hasTenants = signals.tenantCount > 0;

  const done: Record<StepId, boolean> = {
    hostel: hasRooms,
    tenant: hasTenants,
    payment: signals.hasEverCollected,
  };

  const order: StepId[] = ['hostel', 'tenant', 'payment'];
  const firstTodo = order.find((id) => !done[id]) ?? null;

  /**
   * Written for someone who has run a hostel for years and has never run
   * software. Each outstanding step says what to do, why it has to happen
   * before the next one, and roughly how long it takes — the three things
   * that stop a non-technical owner putting the phone down. A finished step
   * drops all of that and states a fact about their hostel instead, so the
   * card gets shorter and calmer as they go rather than staying a wall of
   * instructions.
   */
  const copy: Record<
    StepId,
    { title: string; cta: string; doneDetail: string; todoDetail: string; why: string; duration: string }
  > = {
    hostel: {
      title: 'Set up your hostel',
      cta: 'Start building',
      doneDetail: `${signals.roomCapacity} ${signals.roomCapacity === 1 ? 'bed' : 'beds'} ready`,
      todoDetail: signals.hostelInProgress
        ? signals.hostelInProgress.summary
        : 'Add your floors, then the rooms on each one',
      why: 'Rooms have to exist before anyone can be put in one.',
      duration: 'About 5 minutes',
    },
    tenant: {
      title: 'Invite your first tenant',
      cta: 'Invite a tenant',
      doneDetail: `${signals.tenantCount} ${signals.tenantCount === 1 ? 'tenant' : 'tenants'} on board`,
      todoDetail: 'They get a link to join and fill in their own details',
      why: 'They fill in their own details, so you do not have to type them.',
      duration: 'About 2 minutes',
    },
    payment: {
      title: 'Record your first payment',
      cta: 'Collect rent',
      doneDetail: 'Rent is coming in',
      todoDetail: 'Log a payment, or share a payment link',
      why: 'Once rent is recorded, Stayo keeps track of who still owes you.',
      duration: 'About a minute',
    },
  };

  const steps: GettingStartedStep[] = order.map((id) => ({
    id,
    title: copy[id].title,
    detail: done[id] ? copy[id].doneDetail : copy[id].todoDetail,
    why: done[id] ? null : copy[id].why,
    duration: done[id] ? null : copy[id].duration,
    cta: copy[id].cta,
    state: done[id] ? 'done' : id === firstTodo ? 'current' : 'todo',
  }));

  const doneCount = order.filter((id) => done[id]).length;
  const isComplete = doneCount === order.length;

  return {
    // Every step is now a permanently-true fact, so completion is permanent
    // on its own and needs no stored latch to hold it.
    visible: !isComplete,
    steps,
    doneCount,
    total: order.length,
    percent: Math.round((doneCount / order.length) * 100),
    isComplete,
  };
}

// ── Spotlight ──────────────────────────────────────────────────────────────

/**
 * Whether the one-time orientation spotlight should run.
 *
 * It used to fire on a *completely empty* account, which was exactly the wrong
 * moment twice over. Its three stops pointed at the Action Center and the
 * search bar — neither of which an empty account renders any more (see
 * `homeSections.ts`) — so it dimmed the screen to highlight things that were
 * not there. And on a screen holding one card with one button, a modal tour is
 * noise a non-technical owner dismisses without reading.
 *
 * So it waits until the first hostel is actually built. That is the moment the
 * dashboard has something in it and the tour has something true to point at.
 * It stops for good once the checklist is complete, which also means an
 * established owner who clears their browser storage is never re-toured — the
 * failure mode the old emptiness gate was there to prevent. See ADR-139.
 */
export function shouldRunSpotlight(input: {
  roomCapacity: number;
  /** All three steps done — this owner is past being introduced to anything. */
  isComplete: boolean;
  dismissed: boolean;
  /** Don't compete with a loading dashboard. */
  ready: boolean;
}): boolean {
  if (!input.ready || input.dismissed || input.isComplete) return false;
  return input.roomCapacity > 0;
}

// ── Verification status ────────────────────────────────────────────────────

export type VerificationTone = 'neutral' | 'pending' | 'success' | 'warning';

export interface VerificationStatus {
  label: string;
  detail: string;
  tone: VerificationTone;
}

interface OwnerDocumentLike {
  doc_type?: string | null;
  status?: string | null;
  review_note?: string | null;
}

/** The two documents a Stayo admin reviews before an owner is verified. */
const REQUIRED_DOCS = ['AADHAAR', 'PAN'];

/**
 * Reported, never asked for. The owner cannot advance this — an admin does —
 * so the copy's job is to say it is in hand and that nothing is blocked on it.
 */
export function deriveVerificationStatus(documents: OwnerDocumentLike[] | null | undefined): VerificationStatus {
  const docs = Array.isArray(documents) ? documents : [];

  const rejected = docs.find((doc) => String(doc.status).toUpperCase() === 'REJECTED');
  if (rejected) {
    return {
      label: 'ID needs attention',
      detail: rejected.review_note?.trim() || 'One of your documents was rejected. Re-upload it when you can.',
      tone: 'warning',
    };
  }

  const verifiedTypes = new Set(
    docs
      .filter((doc) => String(doc.status).toUpperCase() === 'VERIFIED')
      .map((doc) => String(doc.doc_type).toUpperCase()),
  );
  if (REQUIRED_DOCS.every((type) => verifiedTypes.has(type))) {
    return { label: 'ID verified', detail: 'Your documents are approved.', tone: 'success' };
  }

  if (docs.length === 0) {
    return {
      label: 'ID not submitted',
      detail: 'Upload your Aadhaar and PAN when convenient. Nothing here is blocked on it.',
      tone: 'neutral',
    };
  }

  return {
    label: 'ID verification in review',
    detail: "We'll email you when it's done. Nothing here is blocked on it.",
    tone: 'pending',
  };
}
