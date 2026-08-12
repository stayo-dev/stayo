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
  cta: string;
  state: StepState;
}

export interface GettingStartedSignals {
  /** Beds across every hostel. Zero means no rooms have been built yet. */
  roomCapacity: number;
  /** Active + invited. An invited tenant counts — the owner did the work. */
  tenantCount: number;
  /** Rent recorded this month. */
  collectedThisMonth: number;
  /**
   * A hostel that exists but has floors with no rooms, for step one's detail.
   */
  hostelInProgress?: { name: string; summary: string } | null;
  /**
   * Set once the owner has completed all three, ever.
   *
   * Load-bearing: the payment signal is *this month's* collection, which
   * resets on the 1st. Without a one-way latch the card would reappear on a
   * long-established account every month, claiming its owner had never taken
   * a payment. Completion is permanent even though the signal is not.
   */
  graduated: boolean;
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
  const hasPayments = signals.collectedThisMonth > 0;

  const done: Record<StepId, boolean> = {
    hostel: hasRooms,
    tenant: hasTenants,
    payment: hasPayments,
  };

  const order: StepId[] = ['hostel', 'tenant', 'payment'];
  const firstTodo = order.find((id) => !done[id]) ?? null;

  const copy: Record<StepId, { title: string; cta: string; doneDetail: string; todoDetail: string }> = {
    hostel: {
      title: 'Set up your hostel',
      cta: 'Start building',
      doneDetail: `${signals.roomCapacity} ${signals.roomCapacity === 1 ? 'bed' : 'beds'} ready`,
      todoDetail: signals.hostelInProgress
        ? signals.hostelInProgress.summary
        : 'Add your floors, then the rooms on each one',
    },
    tenant: {
      title: 'Invite your first tenant',
      cta: 'Invite a tenant',
      doneDetail: `${signals.tenantCount} ${signals.tenantCount === 1 ? 'tenant' : 'tenants'} on board`,
      todoDetail: 'They get a link to join and fill in their own details',
    },
    payment: {
      title: 'Record your first payment',
      cta: 'Collect rent',
      doneDetail: 'Rent is coming in',
      todoDetail: 'Log a payment, or share a payment link',
    },
  };

  const steps: GettingStartedStep[] = order.map((id) => ({
    id,
    title: copy[id].title,
    detail: done[id] ? copy[id].doneDetail : copy[id].todoDetail,
    cta: copy[id].cta,
    state: done[id] ? 'done' : id === firstTodo ? 'current' : 'todo',
  }));

  const doneCount = order.filter((id) => done[id]).length;
  const isComplete = doneCount === order.length;

  return {
    visible: !signals.graduated && !isComplete,
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
 * Gated on real emptiness as well as the dismissal flag. The flag lives in
 * browser storage, so it is lost on a new device or a cleared cache — but
 * because an account with any rooms or tenants is excluded outright, the worst
 * case is re-showing an introduction to someone who still has nothing, which
 * is when showing it is correct anyway.
 */
export function shouldRunSpotlight(input: {
  roomCapacity: number;
  tenantCount: number;
  dismissed: boolean;
  /** Don't compete with a loading dashboard. */
  ready: boolean;
}): boolean {
  if (!input.ready || input.dismissed) return false;
  return input.roomCapacity === 0 && input.tenantCount === 0;
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
