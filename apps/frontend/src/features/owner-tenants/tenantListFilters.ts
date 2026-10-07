/**
 * The Tenants list's filters: which tenants an owner sees, and the counts on
 * every chip. Pure, so it is tested directly; the chips are a thin renderer.
 *
 * Two questions an owner opens this screen with, each a top-level view with
 * its own drill-down:
 *  - **Unpaid**: who owes money past its due date, and how many rents behind.
 *    Counted from `overdueRentCount`, which the API derives from real
 *    obligations. It is never estimated from days late.
 *  - **Invited**: where each invited tenant is stuck. Derived from the latest
 *    invitation's own timestamps, the same fields the invitation timeline
 *    on the profile reads.
 */

import type { MockTenant } from '@shared/mocks/tenants';
import { describeExpiry } from './invitation/invitationWorkspace';

export type TenantView = 'all' | 'unpaid' | 'invited';

export type DuesBucket = '1' | '2' | '3plus' | 'other';

export type InviteStage = NonNullable<MockTenant['inviteStage']>;

export type SubFilter = 'any' | DuesBucket | InviteStage;

export interface InvitationSnapshot {
  status?: string | null;
  sent_at?: string | null;
  opened_at?: string | null;
  activation_started_at?: string | null;
  expires_at?: string | null;
}

export const DUES_BUCKETS: { id: DuesBucket; label: string }[] = [
  { id: '1', label: '1 month' },
  { id: '2', label: '2 months' },
  { id: '3plus', label: '3+ months' },
  { id: 'other', label: 'Deposit / other' },
];

/** Most actionable first: an expired link is dead until the owner resends it. */
export const INVITE_STAGES: { id: InviteStage; label: string; hint: string }[] = [
  { id: 'expired', label: 'Link expired', hint: 'Their link no longer works. Open a tenant and tap Send new link.' },
  { id: 'not-opened', label: 'Not opened', hint: "They haven't opened the link yet. A WhatsApp nudge usually helps." },
  { id: 'opened', label: 'Opened', hint: "They've seen the offer but haven't started creating an account." },
  { id: 'signing-up', label: 'Creating account', hint: 'They started signing up and have not finished yet.' },
  { id: 'accepting', label: 'Awaiting acceptance', hint: 'Account is ready; they still need to accept the tenancy.' },
  { id: 'no-link', label: 'No link sent', hint: 'Added by you without an invitation link. Send one so they can join the app.' },
];

export function inviteStageLabel(stage: InviteStage): string {
  return INVITE_STAGES.find((s) => s.id === stage)?.label ?? 'Invited';
}

export function inviteStageOf(invitation: InvitationSnapshot | null | undefined, now: number = Date.now()): InviteStage {
  if (!invitation) return 'no-link';
  const status = String(invitation.status ?? 'PENDING').toUpperCase();
  if (status === 'CANCELLED') return 'no-link';
  if (status === 'ACTIVATED') return 'accepting';
  if (describeExpiry(invitation.expires_at, now).isExpired) return 'expired';
  if (invitation.activation_started_at || status === 'ACTIVATION_STARTED') return 'signing-up';
  if (invitation.opened_at || status === 'OPENED') return 'opened';
  return 'not-opened';
}

/** Owes money past its due date. Independent of invitation state: an invited tenancy is live and bills rent. */
export function isUnpaid(t: MockTenant): boolean {
  return Boolean(t.paymentOverdue) && (t.overdueAmount ?? t.outstanding) > 0;
}

export function duesBucketOf(t: MockTenant): DuesBucket {
  const n = t.overdueRentCount ?? 0;
  if (n <= 0) return 'other';
  if (n === 1) return '1';
  if (n === 2) return '2';
  return '3plus';
}

export function monthsUnpaidLabel(t: MockTenant): string | null {
  const n = t.overdueRentCount ?? 0;
  if (n <= 0) return null;
  return n === 1 ? '1 month unpaid' : `${n} months unpaid`;
}

function matchesSearch(t: MockTenant, q: string): boolean {
  return t.name.toLowerCase().includes(q) || t.room.toLowerCase().includes(q) || t.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''));
}

export interface TenantFilterState {
  view: TenantView;
  sub: SubFilter;
  search: string;
}

export interface TenantFilterCounts {
  all: number;
  unpaid: number;
  invited: number;
  dues: Record<DuesBucket, number>;
  stages: Record<InviteStage, number>;
  /** Total past-due money across every unpaid tenant in scope. */
  unpaidAmount: number;
}

/** Counts ignore the search box on purpose, so the chips describe the hostel, not the query. */
export function countTenants(list: MockTenant[]): TenantFilterCounts {
  const dues: Record<DuesBucket, number> = { '1': 0, '2': 0, '3plus': 0, other: 0 };
  const stages: Record<InviteStage, number> = { expired: 0, 'not-opened': 0, opened: 0, 'signing-up': 0, accepting: 0, 'no-link': 0 };
  let unpaid = 0;
  let invited = 0;
  let unpaidAmount = 0;
  for (const t of list) {
    if (isUnpaid(t)) {
      unpaid += 1;
      dues[duesBucketOf(t)] += 1;
      unpaidAmount += t.overdueAmount ?? t.outstanding;
    }
    if (t.status === 'invited') {
      invited += 1;
      stages[t.inviteStage ?? 'no-link'] += 1;
    }
  }
  return { all: list.length, unpaid, invited, dues, stages, unpaidAmount };
}

const STAGE_ORDER = new Map(INVITE_STAGES.map((s, i) => [s.id, i]));

export function filterTenants(list: MockTenant[], state: TenantFilterState): MockTenant[] {
  let out = list;
  if (state.view === 'unpaid') {
    out = out.filter(isUnpaid);
    if (state.sub !== 'any') out = out.filter((t) => duesBucketOf(t) === state.sub);
    // Furthest behind first; the money is the tiebreak.
    out = [...out].sort(
      (a, b) =>
        (b.overdueRentCount ?? 0) - (a.overdueRentCount ?? 0) ||
        (b.overdueAmount ?? b.outstanding) - (a.overdueAmount ?? a.outstanding),
    );
  } else if (state.view === 'invited') {
    out = out.filter((t) => t.status === 'invited');
    if (state.sub !== 'any') out = out.filter((t) => (t.inviteStage ?? 'no-link') === state.sub);
    out = [...out].sort(
      (a, b) => (STAGE_ORDER.get(a.inviteStage ?? 'no-link') ?? 99) - (STAGE_ORDER.get(b.inviteStage ?? 'no-link') ?? 99),
    );
  }
  const q = state.search.trim().toLowerCase();
  if (q) out = out.filter((t) => matchesSearch(t, q));
  return out;
}

const VIEWS: TenantView[] = ['all', 'unpaid', 'invited'];
const DUES_IDS = new Set<string>(DUES_BUCKETS.map((b) => b.id));
const STAGE_IDS = new Set<string>(INVITE_STAGES.map((s) => s.id));

/** Reads the filter from the URL, so Back from a tenant's profile returns to the same filtered list. Unknown values fall back to defaults. */
export function parseFilterParams(params: URLSearchParams): { view: TenantView; sub: SubFilter } {
  const rawView = params.get('view');
  const view: TenantView = VIEWS.includes(rawView as TenantView) ? (rawView as TenantView) : 'all';
  const rawSub = params.get('show') ?? 'any';
  const validSub =
    (view === 'unpaid' && DUES_IDS.has(rawSub)) || (view === 'invited' && STAGE_IDS.has(rawSub)) ? (rawSub as SubFilter) : 'any';
  return { view, sub: validSub };
}
