/**
 * Owner health, for an admin managing hundreds of them.
 *
 * The organising rule is that a screen earns its place only if it ends in a
 * decision, so this module's output is not a score for its own sake — it is a
 * reason and an action. An owner is only ever surfaced as needing attention
 * when there is something the admin can actually do about it.
 *
 * **Derived only from signals that exist.** Two dimensions an owner-health
 * model would normally include are deliberately absent because nothing in this
 * system records them:
 *
 *  - **Engagement** — there is no last-login or session tracking. `activity_logs`
 *    holds a last *recorded action*, written by only a handful of services, so
 *    it cannot answer "has this owner logged in recently". Treating its absence
 *    as inactivity would flag every owner who simply hasn't triggered one of
 *    those few code paths.
 *  - **Support** — there is no ticketing backend.
 *
 * Both are reported as untracked rather than scored as healthy, so the gap is
 * visible instead of silently flattering the number.
 */

export type OwnerSignals = {
  id: string;
  name: string;
  joinedAt: string | null;

  hostels: number;
  hostelsLive: number;
  hostelsAwaitingApproval: number;

  tenants: number;
  activeTenants: number;
  capacity: number;

  collectedThisMonth: number;
  outstanding: number;

  documentsSubmitted: number;
  documentsVerified: boolean;
  documentsRejected: boolean;

  mrr: number;
  subscriptionStatuses: string[];
};

export type HealthLevel = 'healthy' | 'attention' | 'at-risk' | 'new';

/** What the admin can actually do about it — drives the card's action. */
export type ReasonAction = 'review-documents' | 'approve-hostel' | 'open-owner' | 'contact-owner';

export interface AttentionReason {
  code:
    | 'DOCS_REJECTED'
    | 'DOCS_MISSING'
    | 'AWAITING_APPROVAL'
    | 'SETUP_INCOMPLETE'
    | 'NO_TENANTS'
    | 'COLLECTIONS_UNUSED'
    | 'PAYMENT_PAST_DUE';
  label: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
  action: ReasonAction;
}

export interface OwnerHealth {
  level: HealthLevel;
  reasons: AttentionReason[];
  /** The single reason worth showing on a list row. */
  headline: AttentionReason | null;
  /** Activation progress, 0–4, as a shipped-value milestone count. */
  activationStage: number;
  activationTotal: number;
}

const DAY = 86_400_000;

/**
 * A brand-new owner is not unhealthy — they are new. Without this, every
 * signup would land in "at risk" within a day of registering and drown the
 * queue that is supposed to show real problems.
 */
const GRACE_DAYS = 3;

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((now - t) / DAY);
}

/**
 * How far the owner has got towards a working business:
 * hostel → rooms → tenants → money.
 */
export function activationStage(signals: OwnerSignals): number {
  let stage = 0;
  if (signals.hostels > 0) stage += 1;
  if (signals.capacity > 0) stage += 1;
  if (signals.tenants > 0) stage += 1;
  if (signals.collectedThisMonth > 0) stage += 1;
  return stage;
}

export function deriveOwnerHealth(signals: OwnerSignals, now: number = Date.now()): OwnerHealth {
  const reasons: AttentionReason[] = [];
  const age = daysSince(signals.joinedAt, now);
  const isNew = age !== null && age < GRACE_DAYS;
  const stage = activationStage(signals);

  // ── Things the admin resolves directly ──────────────────────────────────
  if (signals.documentsRejected) {
    reasons.push({
      code: 'DOCS_REJECTED',
      label: 'Documents rejected',
      detail: 'The owner needs to re-upload before any hostel can go live.',
      severity: 'high',
      action: 'contact-owner',
    });
  } else if (signals.documentsSubmitted > 0 && !signals.documentsVerified) {
    reasons.push({
      code: 'DOCS_MISSING',
      label: 'Documents awaiting review',
      detail: 'Aadhaar and PAN must both be verified before going live.',
      severity: 'high',
      action: 'review-documents',
    });
  }

  if (signals.hostelsAwaitingApproval > 0) {
    reasons.push({
      code: 'AWAITING_APPROVAL',
      label:
        signals.hostelsAwaitingApproval === 1
          ? 'A hostel is waiting for approval'
          : `${signals.hostelsAwaitingApproval} hostels waiting for approval`,
      detail: 'Nothing is listed until you approve it.',
      severity: 'high',
      action: 'approve-hostel',
    });
  }

  if (signals.subscriptionStatuses.some((s) => s === 'PAST_DUE' || s === 'FAILED')) {
    reasons.push({
      code: 'PAYMENT_PAST_DUE',
      label: 'Subscription payment failed',
      detail: 'Billing needs attention before the plan lapses.',
      severity: 'high',
      action: 'open-owner',
    });
  }

  // ── Things that need a nudge, not an admin action ───────────────────────
  if (!isNew && signals.hostels > 0 && signals.capacity === 0) {
    reasons.push({
      code: 'SETUP_INCOMPLETE',
      label: 'Hostel has no rooms',
      detail: 'They created a hostel but never finished building it.',
      severity: 'medium',
      action: 'contact-owner',
    });
  }

  if (!isNew && signals.capacity > 0 && signals.tenants === 0) {
    reasons.push({
      code: 'NO_TENANTS',
      label: 'No tenants yet',
      detail: 'Rooms are set up but nobody has been invited.',
      severity: 'medium',
      action: 'contact-owner',
    });
  }

  // Real usage signal: they have tenants but no money is moving through Stayo,
  // which usually means collections are still happening off-platform.
  if (!isNew && signals.activeTenants > 0 && signals.collectedThisMonth === 0) {
    reasons.push({
      code: 'COLLECTIONS_UNUSED',
      label: 'Not collecting through Stayo',
      detail: `${signals.activeTenants} active ${signals.activeTenants === 1 ? 'tenant' : 'tenants'}, no payments recorded this month.`,
      severity: 'low',
      action: 'contact-owner',
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  reasons.sort((a, b) => order[a.severity] - order[b.severity]);

  let level: HealthLevel;
  if (isNew && stage < 2) level = 'new';
  else if (reasons.some((r) => r.severity === 'high')) level = 'at-risk';
  else if (reasons.length > 0) level = 'attention';
  else level = 'healthy';

  return {
    level,
    reasons,
    headline: reasons[0] ?? null,
    activationStage: stage,
    activationTotal: 4,
  };
}

// ── Dimensions, for the owner profile ──────────────────────────────────────

export type DimensionState = 'good' | 'warn' | 'bad' | 'untracked';

export interface HealthDimension {
  label: string;
  state: DimensionState;
  detail: string;
}

/**
 * The owner profile's health panel.
 *
 * `untracked` is a first-class state, not a gap to paper over: an admin
 * reading "Engagement ✓ Healthy" would reasonably believe engagement was
 * measured. It isn't.
 */
export function healthDimensions(signals: OwnerSignals): HealthDimension[] {
  const stage = activationStage(signals);

  return [
    {
      label: 'Activation',
      state: stage === 4 ? 'good' : stage >= 2 ? 'warn' : 'bad',
      detail: `${stage} of 4 milestones`,
    },
    {
      label: 'Verification',
      state: signals.documentsRejected
        ? 'bad'
        : signals.documentsVerified
          ? 'good'
          : signals.documentsSubmitted > 0
            ? 'warn'
            : 'bad',
      detail: signals.documentsRejected
        ? 'A document was rejected'
        : signals.documentsVerified
          ? 'Aadhaar and PAN verified'
          : signals.documentsSubmitted > 0
            ? 'Awaiting review'
            : 'Nothing submitted',
    },
    {
      label: 'Listing',
      state: signals.hostelsLive > 0 ? 'good' : signals.hostelsAwaitingApproval > 0 ? 'warn' : 'bad',
      detail:
        signals.hostelsLive > 0
          ? `${signals.hostelsLive} live`
          : signals.hostelsAwaitingApproval > 0
            ? 'Waiting on approval'
            : 'Nothing listed',
    },
    {
      label: 'Collections',
      state: signals.collectedThisMonth > 0 ? 'good' : signals.activeTenants > 0 ? 'warn' : 'bad',
      detail:
        signals.collectedThisMonth > 0
          ? 'Money moving through Stayo'
          : signals.activeTenants > 0
            ? 'No payments this month'
            : 'No tenants yet',
    },
    {
      label: 'Subscription',
      state: signals.subscriptionStatuses.some((s) => s === 'ACTIVE')
        ? 'good'
        : signals.subscriptionStatuses.some((s) => s === 'PAST_DUE' || s === 'FAILED')
          ? 'bad'
          : signals.subscriptionStatuses.length > 0
            ? 'warn'
            : 'untracked',
      detail:
        signals.subscriptionStatuses.length === 0
          ? 'No plan yet'
          : signals.subscriptionStatuses.join(', ').toLowerCase(),
    },
    {
      // Stated plainly rather than omitted, so nobody reads the panel as
      // complete coverage.
      label: 'Engagement',
      state: 'untracked',
      detail: 'Login activity is not recorded yet',
    },
  ];
}

// ── List bucketing ─────────────────────────────────────────────────────────

export type OwnerFilter = 'attention' | 'new' | 'active' | 'all';

export function matchesFilter(health: OwnerHealth, filter: OwnerFilter): boolean {
  switch (filter) {
    case 'attention':
      return health.level === 'at-risk' || health.level === 'attention';
    case 'new':
      return health.level === 'new';
    case 'active':
      return health.level === 'healthy';
    case 'all':
    default:
      return true;
  }
}

/** Worst first — the admin should never have to scroll to find the problem. */
const LEVEL_ORDER: Record<HealthLevel, number> = { 'at-risk': 0, attention: 1, new: 2, healthy: 3 };

export function compareByUrgency(a: OwnerHealth, b: OwnerHealth): number {
  return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
}
