/**
 * Hostel setup progress, derived — not stored. Mirrors the `ownerHealth.ts`
 * pattern (`features/platform-admin/owners/ownerHealth.ts`): a hostel's
 * onboarding checklist is computed from signals `GET /platform-admin/hostels`
 * already returns, not tracked in a new table (see Decisions.md ADR-212 —
 * an earlier stored-state attempt, `owner_onboarding_states`, was found
 * dead/never wired and deliberately not resurrected).
 *
 * Deliberately limited to what that endpoint actually returns. House
 * rules, food config, UPI, photos and document-verification are not part of
 * its response today — rather than guess at them, this checklist only
 * covers what can be verified from real data. Extending it to those signals
 * means extending the admin hostels endpoint first, not inventing a value
 * here.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */

export type HostelSignals = {
  verification_status: string | null;
  listing_status: string | null;
  rooms: number;
  capacity: number;
  tenants: number;
  revenue: number;
  subscription_status: string | null;
};

export type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

export type OnboardingChecklist = {
  items: ChecklistItem[];
  completed: number;
  total: number;
  status: 'complete' | 'in_progress';
};

export function computeOnboardingChecklist(signals: HostelSignals): OnboardingChecklist {
  const items: ChecklistItem[] = [
    { id: 'verified', label: 'Platform verified', done: signals.verification_status === 'VERIFIED' },
    { id: 'rooms', label: 'Rooms created', done: signals.rooms > 0 },
    { id: 'capacity', label: 'Beds configured', done: signals.capacity > 0 },
    { id: 'listed', label: 'Listing published', done: signals.listing_status === 'LIVE' },
    { id: 'subscription', label: 'Subscription active', done: signals.subscription_status === 'ACTIVE' },
    { id: 'tenant', label: 'First tenant onboarded', done: signals.tenants > 0 },
    { id: 'payment', label: 'First payment collected', done: signals.revenue > 0 },
  ];
  const completed = items.filter((i) => i.done).length;
  return {
    items,
    completed,
    total: items.length,
    status: completed === items.length ? 'complete' : 'in_progress',
  };
}
