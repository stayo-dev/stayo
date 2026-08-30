import { describe, it, expect } from 'vitest';
import {
  ACTIONABLE_LEAD_STATUSES,
  SETTLED_LEAD_STATUSES,
  compareLeads,
  countLeadsByFilter,
  filterLeads,
  leadFilterFor,
  leadMatchesFilter,
  primaryActionForStatus,
  PRIMARY_ACTION_LABEL,
  type LeadFilter,
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
    hostel: { id: 'h1', name: 'Sunrise Residency' },
    seeker_profile_id: null,
    ...over,
  }) as DynamicLead;

describe('leadFilterFor', () => {
  it('files every open status under New', () => {
    for (const status of ['NEW', 'INTERESTED', 'ROOM_VISITED', 'DECISION_PENDING', 'READY_TO_JOIN']) {
      expect(leadFilterFor(status)).toBe('new');
    }
  });

  // The whole point of the redesign: the UI's "Accepted" tab means the
  // tenant joined, not that the owner said yes with no invite sent yet.
  it('folds ACCEPTED into New rather than giving it its own tab', () => {
    expect(leadFilterFor('ACCEPTED')).toBe('new');
  });

  it('maps INVITED and JOINED to their own separate tabs', () => {
    expect(leadFilterFor('INVITED')).toBe('invited');
    expect(leadFilterFor('JOINED')).toBe('accepted');
  });

  it('maps held and rejected leads to their own tabs', () => {
    expect(leadFilterFor('ON_HOLD')).toBe('hold');
    expect(leadFilterFor('REJECTED')).toBe('rejected');
  });

  it('is case-insensitive', () => {
    expect(leadFilterFor('accepted')).toBe('new');
    expect(leadFilterFor('invited')).toBe('invited');
  });

  // An enquiry must never vanish because of a status this build has not
  // heard of, or LOST (which nothing in this app's UI ever sets).
  it('surfaces an unknown, missing, or LOST status under New rather than hiding it', () => {
    expect(leadFilterFor('SOMETHING_NEW')).toBe('new');
    expect(leadFilterFor('LOST')).toBe('new');
    expect(leadFilterFor(null)).toBe('new');
    expect(leadFilterFor(undefined)).toBe('new');
  });
});

describe('leadMatchesFilter', () => {
  it('matches everything under All', () => {
    expect(leadMatchesFilter(lead({ status: 'REJECTED' }), 'all')).toBe(true);
    expect(leadMatchesFilter(lead({ status: 'NEW' }), 'all')).toBe(true);
  });

  it('matches only its own tab otherwise', () => {
    expect(leadMatchesFilter(lead({ status: 'ON_HOLD' }), 'hold')).toBe(true);
    expect(leadMatchesFilter(lead({ status: 'ON_HOLD' }), 'new')).toBe(false);
  });
});

describe('filterLeads', () => {
  it('returns only the leads matching the given tab', () => {
    const leads = [lead({ id: 'a', status: 'NEW' }), lead({ id: 'b', status: 'REJECTED' })];
    expect(filterLeads(leads, 'new').map((l) => l.id)).toEqual(['a']);
    expect(filterLeads(leads, 'rejected').map((l) => l.id)).toEqual(['b']);
  });

  it('folds ACCEPTED leads in alongside open-status leads under New', () => {
    const leads = [lead({ id: 'a', status: 'NEW' }), lead({ id: 'b', status: 'ACCEPTED' })];
    expect(filterLeads(leads, 'new').map((l) => l.id).sort()).toEqual(['a', 'b']);
  });

  it('puts the hottest lead first under New', () => {
    const leads = [lead({ id: 'cold', status: 'NEW', lead_score: 5 }), lead({ id: 'hot', status: 'NEW', lead_score: 60 })];
    expect(filterLeads(leads, 'new').map((l) => l.id)).toEqual(['hot', 'cold']);
  });

  it('falls back to recency when scores tie, under New', () => {
    const leads = [
      lead({ id: 'older', status: 'NEW', lead_score: 10, last_activity_at: '2026-08-01T00:00:00Z' }),
      lead({ id: 'newer', status: 'NEW', lead_score: 10, last_activity_at: '2026-08-20T00:00:00Z' }),
    ];
    expect(filterLeads(leads, 'new').map((l) => l.id)).toEqual(['newer', 'older']);
  });

  // Nothing outside New is being ranked — it is being looked up.
  it('orders every other tab by recency alone, ignoring score', () => {
    const leads = [
      lead({ id: 'high', status: 'REJECTED', lead_score: 90, last_activity_at: '2026-08-01T00:00:00Z' }),
      lead({ id: 'recent', status: 'REJECTED', lead_score: 1, last_activity_at: '2026-08-20T00:00:00Z' }),
    ];
    expect(filterLeads(leads, 'rejected').map((l) => l.id)).toEqual(['recent', 'high']);
  });

  it('orders All by recency, not by score', () => {
    const leads = [
      lead({ id: 'high', status: 'NEW', lead_score: 90, last_activity_at: '2026-08-01T00:00:00Z' }),
      lead({ id: 'recent', status: 'NEW', lead_score: 1, last_activity_at: '2026-08-20T00:00:00Z' }),
    ];
    expect(filterLeads(leads, 'all').map((l) => l.id)).toEqual(['recent', 'high']);
  });

  it('falls back to created_at when there is no activity timestamp', () => {
    const leads = [
      lead({ id: 'older', status: 'REJECTED', created_at: '2026-08-01T00:00:00Z' }),
      lead({ id: 'newer', status: 'REJECTED', created_at: '2026-08-20T00:00:00Z' }),
    ];
    expect(filterLeads(leads, 'rejected').map((l) => l.id)).toEqual(['newer', 'older']);
  });

  it('treats a missing or unparseable date as oldest rather than throwing', () => {
    const leads = [
      lead({ id: 'broken', status: 'REJECTED', last_activity_at: 'not-a-date' }),
      lead({ id: 'real', status: 'REJECTED', last_activity_at: '2026-08-20T00:00:00Z' }),
    ];
    expect(filterLeads(leads, 'rejected').map((l) => l.id)).toEqual(['real', 'broken']);
  });

  it('does not mutate the array it was given', () => {
    const input = [lead({ id: 'a', status: 'NEW', lead_score: 1 }), lead({ id: 'b', status: 'NEW', lead_score: 9 })];
    const before = input.map((l) => l.id);
    filterLeads(input, 'new');
    expect(input.map((l) => l.id)).toEqual(before);
  });
});

describe('compareLeads', () => {
  // Without a final tiebreak the list can reorder between renders, which reads
  // as the page moving under the owner's finger.
  it('is stable when everything ties', () => {
    const a = lead({ id: 'aaa', status: 'NEW' });
    const b = lead({ id: 'bbb', status: 'NEW' });
    expect(compareLeads(a, b, true)).toBeLessThan(0);
    expect(compareLeads(b, a, true)).toBeGreaterThan(0);
  });
});

describe('countLeadsByFilter', () => {
  it('sums to the total under All', () => {
    const leads = [lead({ id: 'a', status: 'NEW' }), lead({ id: 'b', status: 'ON_HOLD' }), lead({ id: 'c', status: 'REJECTED' })];
    const counts = countLeadsByFilter(leads);
    expect(counts.all).toBe(3);
  });

  it('combines open-status and ACCEPTED leads under New', () => {
    const leads = [lead({ id: 'a', status: 'NEW' }), lead({ id: 'b', status: 'ACCEPTED' }), lead({ id: 'c', status: 'INTERESTED' })];
    const counts = countLeadsByFilter(leads);
    expect(counts.new).toBe(3);
    expect(counts.accepted).toBe(0);
  });

  it('counts each other tab independently', () => {
    const leads = [
      lead({ id: 'a', status: 'ON_HOLD' }),
      lead({ id: 'b', status: 'JOINED' }),
      lead({ id: 'c', status: 'INVITED' }),
      lead({ id: 'd', status: 'REJECTED' }),
    ];
    const counts = countLeadsByFilter(leads);
    expect(counts).toMatchObject({ hold: 1, accepted: 1, invited: 1, rejected: 1 });
  });
});

describe('primaryActionForStatus', () => {
  it('gives an open-status lead the accept-and-invite action', () => {
    for (const status of ['NEW', 'INTERESTED', 'ROOM_VISITED', 'DECISION_PENDING', 'READY_TO_JOIN']) {
      expect(primaryActionForStatus(status)).toBe('accept_invite');
    }
  });

  it('gives a legacy-ACCEPTED lead the finish-invite action, distinct from a brand-new lead', () => {
    expect(primaryActionForStatus('ACCEPTED')).toBe('finish_invite');
  });

  it('gives a held lead the review action', () => {
    expect(primaryActionForStatus('ON_HOLD')).toBe('review');
  });

  // The old card offered WhatsApp on every lead, including ones with nothing
  // left to discuss.
  it('gives a settled lead no primary button at all', () => {
    for (const status of ['INVITED', 'JOINED', 'REJECTED', 'LOST']) {
      expect(primaryActionForStatus(status)).toBeNull();
    }
  });

  it('has a label for every action it can return', () => {
    for (const status of ['NEW', 'ACCEPTED', 'ON_HOLD']) {
      const action = primaryActionForStatus(status)!;
      expect(PRIMARY_ACTION_LABEL[action]).toBeTruthy();
    }
  });
});

// The fetch splits the inbox in two; the filters split it in six. If the two
// ever disagree, a lead is fetched into a tab that does not exist or — worse
// — never fetched at all.
describe('the fetch sets agree with the filters', () => {
  it('sends every actionable status to New or Hold', () => {
    for (const status of ACTIONABLE_LEAD_STATUSES) {
      expect(['new', 'hold'] as LeadFilter[]).toContain(leadFilterFor(status));
    }
  });

  it('sends every settled status except LOST to Accepted, Invited, or Rejected', () => {
    for (const status of SETTLED_LEAD_STATUSES) {
      if (status === 'LOST') continue;
      expect(['accepted', 'invited', 'rejected'] as LeadFilter[]).toContain(leadFilterFor(status));
    }
  });

  it('covers every status exactly once between the two sets', () => {
    const all = [...ACTIONABLE_LEAD_STATUSES, ...SETTLED_LEAD_STATUSES];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(11);
  });
});
