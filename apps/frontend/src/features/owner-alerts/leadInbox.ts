import type { DynamicLead } from './hooks/useAlerts';

/**
 * The Leads list, arranged by what the owner still has to do about each one.
 *
 * It used to be one flat list in arrival order, every card styled the same.
 * An owner with four settled enquiries and one new one had to read all five
 * to find the one that needed them — and a new enquiry landed *among* the
 * settled ones rather than above them. The screenshot that prompted this
 * showed four "Accepted" cards filling the screen, each offering Call and
 * WhatsApp as though there were still a conversation to have.
 *
 * So: five groups, ordered by urgency, each stating what it is for. The two
 * that need the owner are open by default; the three that are finished or
 * parked are collapsed to a single line with a count. An empty group does not
 * render at all.
 *
 * `awaiting_invite` is deliberately its own group rather than being filed
 * under "done". A lead marked ACCEPTED with no invitation sent is **half
 * finished**, and the old UI's "Accepted" pill made it look complete — that is
 * the exact confusion that produced [[Decisions#ADR-104|ADR-104]]. Naming the
 * group after the missing step is the point.
 *
 * PURE MODULE — `apps/frontend` tests run without a DOM, and ordering that
 * silently regresses is the kind of thing nobody notices until an owner misses
 * an enquiry.
 */

export type LeadGroupId = 'needs_action' | 'awaiting_invite' | 'on_hold' | 'converted' | 'closed';

export interface LeadGroup {
  id: LeadGroupId;
  /** Section heading. */
  label: string;
  /** One line under the heading, only shown when the group is open. */
  hint: string;
  leads: DynamicLead[];
  /** Whether it starts expanded. Finished work does not. */
  defaultOpen: boolean;
}

/** Still under consideration — the owner has not decided. */
const OPEN_STATUSES = ['NEW', 'INTERESTED', 'ROOM_VISITED', 'DECISION_PENDING', 'READY_TO_JOIN'];

/**
 * The two halves the inbox is fetched in, derived from the same lists that
 * drive the grouping so the two can never disagree.
 *
 * They are fetched separately because `listLeads` orders by `lead_score desc`:
 * a brand-new enquiry has a low score, so with one page of 20 it sorts *below*
 * settled high-score leads and can fall off the end entirely. Asking for the
 * actionable set as its own page is what guarantees an owner sees every
 * enquiry that still needs them, however much finished work has piled up.
 */
export const ACTIONABLE_LEAD_STATUSES = [...OPEN_STATUSES, 'ACCEPTED', 'ON_HOLD'];
export const SETTLED_LEAD_STATUSES = ['INVITED', 'JOINED', 'REJECTED', 'LOST'];

export function groupIdFor(status: string | null | undefined): LeadGroupId {
  const s = String(status ?? '').toUpperCase();
  if (OPEN_STATUSES.includes(s)) return 'needs_action';
  if (s === 'ACCEPTED') return 'awaiting_invite';
  if (s === 'ON_HOLD') return 'on_hold';
  if (s === 'INVITED' || s === 'JOINED') return 'converted';
  if (s === 'REJECTED' || s === 'LOST') return 'closed';
  // An unrecognised status is a decision nobody has made, so it surfaces
  // rather than disappearing into a collapsed group.
  return 'needs_action';
}

const GROUP_ORDER: LeadGroupId[] = ['needs_action', 'awaiting_invite', 'on_hold', 'converted', 'closed'];

const GROUP_META: Record<LeadGroupId, { label: string; hint: string; defaultOpen: boolean }> = {
  needs_action: {
    label: 'Needs you',
    hint: 'New enquiries waiting on a decision.',
    defaultOpen: true,
  },
  awaiting_invite: {
    // Named after the missing step, not the status. "Accepted" read as done.
    label: 'Accepted — invitation not sent',
    hint: 'You said yes to these. They are not tenants until the invitation goes out.',
    defaultOpen: true,
  },
  on_hold: {
    label: 'On hold',
    hint: 'Parked with a note. Pick them up when the reason clears.',
    defaultOpen: false,
  },
  converted: {
    label: 'Invited & joined',
    hint: 'Already tenants, or on their way in.',
    defaultOpen: false,
  },
  closed: {
    label: 'Closed',
    hint: 'Rejected, or not proceeding.',
    defaultOpen: false,
  },
};

const time = (value: unknown): number => {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Within "Needs you", the hottest lead comes first.
 *
 * `lead_score` is the funnel's own signal (a room visit and a join request
 * both move it), so ordering by it puts the person most likely to take a bed
 * at the top instead of whoever happened to enquire most recently. Ties fall
 * back to recency, and then to id so the order never wobbles between renders.
 *
 * Every other group is plain recency: nothing there is being ranked, it is
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

export function groupLeads(leads: DynamicLead[]): LeadGroup[] {
  const buckets = new Map<LeadGroupId, DynamicLead[]>();
  for (const id of GROUP_ORDER) buckets.set(id, []);
  for (const lead of leads) buckets.get(groupIdFor(lead.status))!.push(lead);

  return GROUP_ORDER.map((id) => {
    const meta = GROUP_META[id];
    const bucket = buckets.get(id)!.slice().sort((a, b) => compareLeads(a, b, id === 'needs_action'));
    return { id, label: meta.label, hint: meta.hint, leads: bucket, defaultOpen: meta.defaultOpen };
  }).filter((group) => group.leads.length > 0);
}

/**
 * What the dark button on a card should do, per group.
 *
 * The old list gave every lead the same WhatsApp button, including ones with
 * nothing left to discuss. The primary action should be the next step, and a
 * lead that has no next step should not have a primary button at all.
 */
export type LeadPrimaryAction = 'accept_invite' | 'finish_invite' | 'review' | null;

export function primaryActionFor(group: LeadGroupId): LeadPrimaryAction {
  if (group === 'needs_action') return 'accept_invite';
  if (group === 'awaiting_invite') return 'finish_invite';
  if (group === 'on_hold') return 'review';
  return null;
}

export const PRIMARY_ACTION_LABEL: Record<Exclude<LeadPrimaryAction, null>, string> = {
  accept_invite: 'Accept & invite',
  finish_invite: 'Send invitation',
  review: 'Review',
};

/**
 * Whether a group should be shown expanded right now.
 *
 * A collapsed group that contains search matches would make the search look
 * broken — you type a name, the count says 1, and the row is behind a chevron
 * you did not know to open. So an active query overrides the default.
 */
export function isGroupOpen(
  group: LeadGroup,
  toggled: Partial<Record<LeadGroupId, boolean>>,
  searchActive: boolean,
): boolean {
  const manual = toggled[group.id];
  if (manual !== undefined) return manual;
  if (searchActive) return true;
  return group.defaultOpen;
}
