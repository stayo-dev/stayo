import { describe, it, expect } from 'vitest';
import {
  ACTIONABLE_LEAD_STATUSES,
  SETTLED_LEAD_STATUSES,
  compareLeads,
  groupIdFor,
  groupLeads,
  isGroupOpen,
  primaryActionFor,
  PRIMARY_ACTION_LABEL,
  type LeadGroupId,
} from './leadInbox';
import type { DynamicLead } from './hooks/useAlerts';

const lead = (over: Partial<DynamicLead> & Record<string, unknown> = {}): DynamicLead =>
  ({
    id: 'l1',
    student_name: 'Riya Sharma',
    student_phone: '9845013001',
    source: 'DISCOVER',
    status: 'NEW',
    hostel_id: 'h1',
    hostel: { id: 'h1', name: 'Sri Adithya Boys Hostel' },
    seeker_profile_id: null,
    ...over,
  }) as DynamicLead;

describe('groupIdFor', () => {
  it('files every open status under Needs you', () => {
    for (const status of ['NEW', 'INTERESTED', 'ROOM_VISITED', 'DECISION_PENDING', 'READY_TO_JOIN']) {
      expect(groupIdFor(status)).toBe('needs_action');
    }
  });

  // The whole point of the redesign: ACCEPTED is half-finished work, not done.
  it('keeps ACCEPTED separate from converted leads', () => {
    expect(groupIdFor('ACCEPTED')).toBe('awaiting_invite');
    expect(groupIdFor('INVITED')).toBe('converted');
    expect(groupIdFor('JOINED')).toBe('converted');
  });

  it('files held and closed leads under their own groups', () => {
    expect(groupIdFor('ON_HOLD')).toBe('on_hold');
    expect(groupIdFor('REJECTED')).toBe('closed');
    expect(groupIdFor('LOST')).toBe('closed');
  });

  it('is case-insensitive', () => {
    expect(groupIdFor('accepted')).toBe('awaiting_invite');
  });

  // An enquiry must never vanish into a collapsed group because of a status
  // this build has not heard of.
  it('surfaces an unknown or missing status rather than hiding it', () => {
    expect(groupIdFor('SOMETHING_NEW')).toBe('needs_action');
    expect(groupIdFor(null)).toBe('needs_action');
    expect(groupIdFor(undefined)).toBe('needs_action');
  });
});

describe('groupLeads', () => {
  it('drops empty groups entirely', () => {
    const groups = groupLeads([lead({ status: 'NEW' })]);
    expect(groups.map((g) => g.id)).toEqual(['needs_action']);
  });

  it('orders groups by urgency, not by status name', () => {
    const groups = groupLeads([
      lead({ id: 'a', status: 'REJECTED' }),
      lead({ id: 'b', status: 'INVITED' }),
      lead({ id: 'c', status: 'ON_HOLD' }),
      lead({ id: 'd', status: 'ACCEPTED' }),
      lead({ id: 'e', status: 'NEW' }),
    ]);
    expect(groups.map((g) => g.id)).toEqual([
      'needs_action',
      'awaiting_invite',
      'on_hold',
      'converted',
      'closed',
    ]);
  });

  it('opens the two groups that need the owner and collapses the rest', () => {
    const groups = groupLeads([
      lead({ id: 'a', status: 'NEW' }),
      lead({ id: 'b', status: 'ACCEPTED' }),
      lead({ id: 'c', status: 'ON_HOLD' }),
      lead({ id: 'd', status: 'INVITED' }),
      lead({ id: 'e', status: 'LOST' }),
    ]);
    const open = Object.fromEntries(groups.map((g) => [g.id, g.defaultOpen]));
    expect(open).toEqual({
      needs_action: true,
      awaiting_invite: true,
      on_hold: false,
      converted: false,
      closed: false,
    });
  });

  it('names the awaiting group after the missing step, not the status', () => {
    const [group] = groupLeads([lead({ status: 'ACCEPTED' })]);
    expect(group.label).toMatch(/invitation not sent/i);
    expect(group.hint).toMatch(/not tenants until the invitation goes out/i);
  });

  it('loses no lead', () => {
    const input = ['NEW', 'ACCEPTED', 'ON_HOLD', 'INVITED', 'JOINED', 'REJECTED', 'LOST'].map((status, i) =>
      lead({ id: `l${i}`, status }),
    );
    const total = groupLeads(input).reduce((sum, g) => sum + g.leads.length, 0);
    expect(total).toBe(input.length);
  });

  it('does not mutate the array it was given', () => {
    const input = [lead({ id: 'a', status: 'NEW', lead_score: 1 }), lead({ id: 'b', status: 'NEW', lead_score: 9 })];
    const before = input.map((l) => l.id);
    groupLeads(input);
    expect(input.map((l) => l.id)).toEqual(before);
  });
});

describe('compareLeads — ordering inside a group', () => {
  it('puts the hottest lead first in Needs you', () => {
    const groups = groupLeads([
      lead({ id: 'cold', status: 'NEW', lead_score: 5 }),
      lead({ id: 'hot', status: 'NEW', lead_score: 60 }),
    ]);
    expect(groups[0].leads.map((l) => l.id)).toEqual(['hot', 'cold']);
  });

  it('falls back to recency when scores tie', () => {
    const groups = groupLeads([
      lead({ id: 'older', status: 'NEW', lead_score: 10, last_activity_at: '2026-08-01T00:00:00Z' }),
      lead({ id: 'newer', status: 'NEW', lead_score: 10, last_activity_at: '2026-08-20T00:00:00Z' }),
    ]);
    expect(groups[0].leads.map((l) => l.id)).toEqual(['newer', 'older']);
  });

  // Nothing in a settled group is being ranked — it is being looked up.
  it('orders the other groups by recency alone, ignoring score', () => {
    const groups = groupLeads([
      lead({ id: 'high', status: 'REJECTED', lead_score: 90, last_activity_at: '2026-08-01T00:00:00Z' }),
      lead({ id: 'recent', status: 'REJECTED', lead_score: 1, last_activity_at: '2026-08-20T00:00:00Z' }),
    ]);
    expect(groups[0].leads.map((l) => l.id)).toEqual(['recent', 'high']);
  });

  it('falls back to created_at when there is no activity timestamp', () => {
    const groups = groupLeads([
      lead({ id: 'older', status: 'REJECTED', created_at: '2026-08-01T00:00:00Z' }),
      lead({ id: 'newer', status: 'REJECTED', created_at: '2026-08-20T00:00:00Z' }),
    ]);
    expect(groups[0].leads.map((l) => l.id)).toEqual(['newer', 'older']);
  });

  // Without a final tiebreak the list can reorder between renders, which reads
  // as the page moving under the owner's finger.
  it('is stable when everything ties', () => {
    const a = lead({ id: 'aaa', status: 'NEW' });
    const b = lead({ id: 'bbb', status: 'NEW' });
    expect(compareLeads(a, b, true)).toBeLessThan(0);
    expect(compareLeads(b, a, true)).toBeGreaterThan(0);
  });

  it('treats a missing or unparseable date as oldest rather than throwing', () => {
    const groups = groupLeads([
      lead({ id: 'broken', status: 'REJECTED', last_activity_at: 'not-a-date' }),
      lead({ id: 'real', status: 'REJECTED', last_activity_at: '2026-08-20T00:00:00Z' }),
    ]);
    expect(groups[0].leads.map((l) => l.id)).toEqual(['real', 'broken']);
  });
});

describe('primaryActionFor', () => {
  it('gives each actionable group its actual next step', () => {
    expect(primaryActionFor('needs_action')).toBe('accept_invite');
    expect(primaryActionFor('awaiting_invite')).toBe('finish_invite');
    expect(primaryActionFor('on_hold')).toBe('review');
  });

  // The old list offered WhatsApp on every card, including leads with nothing
  // left to discuss.
  it('gives a finished lead no primary button at all', () => {
    expect(primaryActionFor('converted')).toBeNull();
    expect(primaryActionFor('closed')).toBeNull();
  });

  it('has a label for every action it can return', () => {
    for (const group of ['needs_action', 'awaiting_invite', 'on_hold'] as LeadGroupId[]) {
      const action = primaryActionFor(group)!;
      expect(PRIMARY_ACTION_LABEL[action]).toBeTruthy();
    }
  });
});

describe('isGroupOpen', () => {
  const collapsed = groupLeads([lead({ status: 'REJECTED' })])[0];
  const expanded = groupLeads([lead({ status: 'NEW' })])[0];

  it('follows the default when untouched and not searching', () => {
    expect(isGroupOpen(collapsed, {}, false)).toBe(false);
    expect(isGroupOpen(expanded, {}, false)).toBe(true);
  });

  // Typing a name, seeing the count say 1, and finding nothing on screen makes
  // the search look broken.
  it('opens a collapsed group while a search is running', () => {
    expect(isGroupOpen(collapsed, {}, true)).toBe(true);
  });

  it('lets the owner override in either direction, search or not', () => {
    expect(isGroupOpen(collapsed, { closed: true }, false)).toBe(true);
    expect(isGroupOpen(expanded, { needs_action: false }, false)).toBe(false);
    expect(isGroupOpen(collapsed, { closed: false }, true)).toBe(false);
  });
});

// The fetch splits the inbox in two; the grouping splits it in five. If the
// two ever disagree, a lead is fetched into a group that does not exist or —
// worse — never fetched at all.
describe('the fetch sets agree with the grouping', () => {
  it('sends every actionable status to an open-by-default group', () => {
    for (const status of ACTIONABLE_LEAD_STATUSES) {
      expect(['needs_action', 'awaiting_invite', 'on_hold']).toContain(groupIdFor(status));
    }
  });

  it('sends every settled status to a collapsed group', () => {
    for (const status of SETTLED_LEAD_STATUSES) {
      expect(['converted', 'closed']).toContain(groupIdFor(status));
    }
  });

  it('covers every status exactly once between the two sets', () => {
    const all = [...ACTIONABLE_LEAD_STATUSES, ...SETTLED_LEAD_STATUSES];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(11);
  });
});
