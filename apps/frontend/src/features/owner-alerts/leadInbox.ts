import type { DynamicLead } from './hooks/useAlerts';

/**
 * The Leads list, filtered by what the owner still has to do about each one.
 *
 * Six tabs — All, New, Hold, Accepted, Invited, Rejected — replace an earlier
 * five-group collapsible layout (ADR-104/106). "Accepted" here means the
 * tenant actually completed onboarding (backend status `JOINED`), not the
 * raw `ACCEPTED` status — see [[Decisions#ADR-122|ADR-122]]. `ACCEPTED`
 * itself ("owner said yes, invitation not sent yet") is now a vestigial
 * status the main "Accept & invite" flow skips past, so those leads fold
 * into New rather than getting their own tab; the existing per-lead status
 * pill on `LeadCard` already reads "Accepted" for them, which is enough to
 * tell them apart from a brand-new enquiry. `LOST` is excluded from every
 * tab, same as before — nothing in this app's UI has ever set it.
 *
 * PURE MODULE — `apps/frontend` tests run without a DOM, and filtering that
 * silently drops a lead is the kind of thing nobody notices until an owner
 * misses an enquiry.
 */

export type LeadFilter = 'all' | 'new' | 'hold' | 'accepted' | 'invited' | 'rejected';

export const LEAD_FILTER_ORDER: LeadFilter[] = ['all', 'new', 'hold', 'invited', 'accepted', 'rejected'];

export const LEAD_FILTER_LABEL: Record<LeadFilter, string> = {
  all: 'All',
  new: 'New',
  hold: 'Hold',
  accepted: 'Accepted',
  invited: 'Invited',
  rejected: 'Rejected',
};

/** Still under consideration — the owner has not decided. */
export const OPEN_STATUSES = ['NEW', 'INTERESTED', 'ROOM_VISITED', 'DECISION_PENDING', 'READY_TO_JOIN'];

/**
 * The two halves the inbox is fetched in, derived from the same lists that
 * drive filtering so the two can never disagree.
 *
 * They are fetched separately because `listLeads` orders by `lead_score desc`:
 * a brand-new enquiry has a low score, so with one page of 20 it sorts *below*
 * settled high-score leads and can fall off the end entirely. Asking for the
 * actionable set as its own page is what guarantees an owner sees every
 * enquiry that still needs them, however much finished work has piled up.
 */
export const ACTIONABLE_LEAD_STATUSES = [...OPEN_STATUSES, 'ACCEPTED', 'ON_HOLD'];
export const SETTLED_LEAD_STATUSES = ['INVITED', 'JOINED', 'REJECTED', 'LOST'];

/** Which tabs can hold a settled lead — drives the "Show older" pagination button's visibility. */
export const SETTLED_INCLUDING_FILTERS: LeadFilter[] = ['all', 'accepted', 'invited', 'rejected'];

/**
 * Raw status → which tab it belongs to. `ACCEPTED` folds into `'new'`
 * (deliberately, see the module doc above); an unrecognised status or `LOST`
 * also falls into `'new'` rather than vanishing, though `LOST` is never
 * actually fetched (excluded from both status sets above) so this is a
 * defensive default rather than a live path.
 */
export function leadFilterFor(status: string | null | undefined): Exclude<LeadFilter, 'all'> {
  const s = String(status ?? '').toUpperCase();
  if (OPEN_STATUSES.includes(s) || s === 'ACCEPTED') return 'new';
  if (s === 'ON_HOLD') return 'hold';
  if (s === 'JOINED') return 'accepted';
  if (s === 'INVITED') return 'invited';
  if (s === 'REJECTED') return 'rejected';
  return 'new';
}

export function leadMatchesFilter(lead: DynamicLead, filter: LeadFilter): boolean {
  if (filter === 'all') return true;
  return leadFilterFor(lead.status) === filter;
}

const time = (value: unknown): number => {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Within New, the hottest lead comes first.
 *
 * `lead_score` is the funnel's own signal (a room visit and a join request
 * both move it), so ordering by it puts the person most likely to take a bed
 * at the top instead of whoever happened to enquire most recently. Ties fall
 * back to recency, and then to id so the order never wobbles between renders.
 *
 * Every other tab is plain recency: nothing there is being ranked, it is
 * being looked up.
 */
export function compareLeads(a: DynamicLead, b: DynamicLead, byScore: boolean): number {
  if (byScore) {
    const scoreDiff = Number((b as any).lead_score ?? 0) - Number((a as any).lead_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
  }
  const recency = time((b as any).last_activity_at ?? (b as any).created_at) -
    time((a as any).last_activity_at ?? (a as any).created_at);
  if (recency !== 0) return recency;
  return String(a.id).localeCompare(String(b.id));
}

/** Filters to the given tab, then sorts (New by score, everything else by recency). Does not mutate its input. */
export function filterLeads(leads: DynamicLead[], filter: LeadFilter): DynamicLead[] {
  const matched = leads.filter((l) => leadMatchesFilter(l, filter));
  return matched.slice().sort((a, b) => compareLeads(a, b, filter === 'new'));
}

/** One count per tab, computed from the same list that gets rendered, so they can never disagree. */
export function countLeadsByFilter(leads: DynamicLead[]): Record<LeadFilter, number> {
  const counts: Record<LeadFilter, number> = { all: leads.length, new: 0, hold: 0, accepted: 0, invited: 0, rejected: 0 };
  for (const lead of leads) counts[leadFilterFor(lead.status)]++;
  return counts;
}

/**
 * What the dark button on a card should do, derived from the lead's own
 * status — not from which tab it happens to be viewed in, since New can now
 * hold both brand-new leads (need "Accept & invite") and legacy-ACCEPTED
 * leads (need "Send invitation") side by side.
 */
export type LeadPrimaryAction = 'accept_invite' | 'finish_invite' | 'review' | null;

export function primaryActionForStatus(status: string | null | undefined): LeadPrimaryAction {
  const s = String(status ?? '').toUpperCase();
  if (s === 'ACCEPTED') return 'finish_invite';
  if (OPEN_STATUSES.includes(s)) return 'accept_invite';
  if (s === 'ON_HOLD') return 'review';
  return null;
}

export const PRIMARY_ACTION_LABEL: Record<Exclude<LeadPrimaryAction, null>, string> = {
  accept_invite: 'Accept & invite',
  finish_invite: 'Send invitation',
  review: 'Review',
};
