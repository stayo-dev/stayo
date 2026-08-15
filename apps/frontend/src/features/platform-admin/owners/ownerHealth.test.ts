import { describe, it, expect } from 'vitest';
import {
  activationStage,
  compareByUrgency,
  deriveOwnerHealth,
  healthDimensions,
  matchesFilter,
  type OwnerSignals,
} from './ownerHealth';

const NOW = new Date('2026-08-12T10:00:00.000Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const owner = (over: Partial<OwnerSignals> = {}): OwnerSignals => ({
  id: 'o1',
  name: 'Shivaprakash',
  joinedAt: daysAgo(60),
  hostels: 2,
  hostelsLive: 2,
  hostelsAwaitingApproval: 0,
  tenants: 130,
  activeTenants: 120,
  capacity: 150,
  collectedThisMonth: 780000,
  outstanding: 0,
  documentsSubmitted: 2,
  documentsVerified: true,
  documentsRejected: false,
  mrr: 4999,
  subscriptionStatuses: ['ACTIVE'],
  ...over,
});

describe('activationStage', () => {
  it('counts the four milestones that make a working business', () => {
    expect(activationStage(owner())).toBe(4);
    expect(activationStage(owner({ collectedThisMonth: 0 }))).toBe(3);
    expect(activationStage(owner({ tenants: 0, collectedThisMonth: 0 }))).toBe(2);
    expect(activationStage(owner({ capacity: 0, tenants: 0, collectedThisMonth: 0 }))).toBe(1);
    expect(activationStage(owner({ hostels: 0, capacity: 0, tenants: 0, collectedThisMonth: 0 }))).toBe(0);
  });
});

describe('deriveOwnerHealth', () => {
  it('leaves a fully working owner alone', () => {
    const health = deriveOwnerHealth(owner(), NOW);
    expect(health.level).toBe('healthy');
    expect(health.reasons).toEqual([]);
    expect(health.headline).toBeNull();
  });

  it('does not punish an owner who signed up yesterday', () => {
    // Without a grace window every new signup would land in the at-risk queue
    // within a day and bury the owners with real problems.
    const health = deriveOwnerHealth(
      owner({ joinedAt: daysAgo(1), hostels: 0, capacity: 0, tenants: 0, collectedThisMonth: 0, documentsSubmitted: 0, documentsVerified: false, subscriptionStatuses: [] }),
      NOW,
    );
    expect(health.level).toBe('new');
    expect(health.reasons).toEqual([]);
  });

  it('flags a stalled build once the grace window has passed', () => {
    const health = deriveOwnerHealth(
      owner({ joinedAt: daysAgo(12), hostels: 1, capacity: 0, tenants: 0, activeTenants: 0, collectedThisMonth: 0 }),
      NOW,
    );
    expect(health.reasons.map((r) => r.code)).toContain('SETUP_INCOMPLETE');
  });

  it('treats a hostel waiting on approval as high severity — only the admin can clear it', () => {
    const health = deriveOwnerHealth(owner({ hostelsAwaitingApproval: 2, hostelsLive: 0 }), NOW);
    expect(health.level).toBe('at-risk');
    expect(health.headline?.code).toBe('AWAITING_APPROVAL');
    expect(health.headline?.label).toBe('2 hostels waiting for approval');
    expect(health.headline?.action).toBe('approve-hostel');
  });

  it('routes a document review to the admin and a rejection to the owner', () => {
    const pending = deriveOwnerHealth(owner({ documentsVerified: false, documentsSubmitted: 2 }), NOW);
    expect(pending.headline).toMatchObject({ code: 'DOCS_MISSING', action: 'review-documents' });

    const rejected = deriveOwnerHealth(owner({ documentsVerified: false, documentsRejected: true }), NOW);
    expect(rejected.headline).toMatchObject({ code: 'DOCS_REJECTED', action: 'contact-owner' });
  });

  it('spots an owner with tenants who is not collecting through Stayo', () => {
    const health = deriveOwnerHealth(owner({ collectedThisMonth: 0 }), NOW);
    expect(health.reasons.map((r) => r.code)).toContain('COLLECTIONS_UNUSED');
    expect(health.level).toBe('attention');
    expect(health.headline?.detail).toBe('120 active tenants, no payments recorded this month.');
  });

  it('does not raise "not collecting" for an owner with no tenants', () => {
    const health = deriveOwnerHealth(owner({ activeTenants: 0, tenants: 0, collectedThisMonth: 0 }), NOW);
    expect(health.reasons.map((r) => r.code)).not.toContain('COLLECTIONS_UNUSED');
  });

  it('flags a failed subscription payment', () => {
    const health = deriveOwnerHealth(owner({ subscriptionStatuses: ['PAST_DUE'] }), NOW);
    expect(health.level).toBe('at-risk');
    expect(health.reasons.map((r) => r.code)).toContain('PAYMENT_PAST_DUE');
  });

  it('shows the most severe reason first', () => {
    const health = deriveOwnerHealth(
      owner({ collectedThisMonth: 0, hostelsAwaitingApproval: 1 }),
      NOW,
    );
    expect(health.headline?.severity).toBe('high');
    expect(health.reasons[health.reasons.length - 1].severity).toBe('low');
  });

  it('separates at-risk from merely needing attention', () => {
    expect(deriveOwnerHealth(owner({ hostelsAwaitingApproval: 1 }), NOW).level).toBe('at-risk');
    expect(deriveOwnerHealth(owner({ collectedThisMonth: 0 }), NOW).level).toBe('attention');
  });

  it('handles an owner with no join date rather than assuming they are new', () => {
    const health = deriveOwnerHealth(owner({ joinedAt: null, hostels: 1, capacity: 0 }), NOW);
    expect(health.level).not.toBe('new');
  });
});

describe('healthDimensions', () => {
  it('reports engagement as untracked, never as healthy', () => {
    // There is no login tracking; scoring this "good" would tell the admin a
    // dimension was measured when it is not.
    const engagement = healthDimensions(owner()).find((d) => d.label === 'Engagement');
    expect(engagement).toMatchObject({ state: 'untracked' });
    expect(engagement?.detail).toContain('not recorded');
  });

  it('marks an owner with no plan as untracked rather than failing', () => {
    const subscription = healthDimensions(owner({ subscriptionStatuses: [] })).find((d) => d.label === 'Subscription');
    expect(subscription).toMatchObject({ state: 'untracked', detail: 'No plan yet' });
  });

  it('scores the four real dimensions for a working owner', () => {
    const dims = healthDimensions(owner());
    const byLabel = Object.fromEntries(dims.map((d) => [d.label, d.state]));
    expect(byLabel).toMatchObject({
      Activation: 'good',
      Verification: 'good',
      Listing: 'good',
      Collections: 'good',
    });
  });

  it('degrades verification correctly across its three real states', () => {
    const state = (o: Partial<OwnerSignals>) =>
      healthDimensions(owner(o)).find((d) => d.label === 'Verification')!.state;
    expect(state({ documentsRejected: true, documentsVerified: false })).toBe('bad');
    expect(state({ documentsVerified: false, documentsSubmitted: 1 })).toBe('warn');
    expect(state({ documentsVerified: false, documentsSubmitted: 0 })).toBe('bad');
  });
});

describe('list bucketing', () => {
  it('puts both at-risk and attention owners in the attention filter', () => {
    const atRisk = deriveOwnerHealth(owner({ hostelsAwaitingApproval: 1 }), NOW);
    const attention = deriveOwnerHealth(owner({ collectedThisMonth: 0 }), NOW);
    const healthy = deriveOwnerHealth(owner(), NOW);

    expect(matchesFilter(atRisk, 'attention')).toBe(true);
    expect(matchesFilter(attention, 'attention')).toBe(true);
    expect(matchesFilter(healthy, 'attention')).toBe(false);
    expect(matchesFilter(healthy, 'all')).toBe(true);
  });

  it('sorts the worst problems to the top', () => {
    const levels = [
      deriveOwnerHealth(owner(), NOW),
      deriveOwnerHealth(owner({ hostelsAwaitingApproval: 1 }), NOW),
      deriveOwnerHealth(owner({ collectedThisMonth: 0 }), NOW),
    ]
      .sort(compareByUrgency)
      .map((h) => h.level);

    expect(levels).toEqual(['at-risk', 'attention', 'healthy']);
  });
});
