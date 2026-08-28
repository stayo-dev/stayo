import { describe, it, expect } from 'vitest';
import {
  resolveActiveRequest,
  decideLane,
  summariseSettlement,
  completionLabel,
  buildConsequences,
  exitProgress,
  canonicalStatus,
  type SettlementPreview,
} from './moveOutPlan';

const preview = (over: Partial<SettlementPreview> = {}): SettlementPreview => ({
  net_settlement_amount: 0,
  settlement_direction: 'SETTLED',
  total_dues: 0,
  total_deductions: 0,
  security_deposit_amount: 0,
  advance_balance: 0,
  ...over,
});

describe('resolveActiveRequest', () => {
  it('prefers an in-flight request over a completed one, whatever the order', () => {
    // The list arrives `created_at desc`, so a re-admitted tenant's OLD
    // completed request can sit ahead of their current one.
    const { active } = resolveActiveRequest(
      [
        { id: 'old', tenant_id: 't1', status: 'COMPLETED' },
        { id: 'new', tenant_id: 't1', status: 'REQUESTED' },
      ],
      't1',
    );
    expect(active?.id).toBe('new');
  });

  it('returns no active request when the tenant has only completed exits', () => {
    const { active, lastCompleted } = resolveActiveRequest(
      [{ id: 'old', tenant_id: 't1', status: 'COMPLETED' }],
      't1',
    );
    // This is what lets a re-admitted tenant start a fresh move-out instead of
    // being shown "Move-out completed" forever.
    expect(active).toBeNull();
    expect(lastCompleted?.id).toBe('old');
  });

  it('ignores other tenants entirely', () => {
    const { active } = resolveActiveRequest(
      [{ id: 'x', tenant_id: 't2', status: 'REQUESTED' }],
      't1',
    );
    expect(active).toBeNull();
  });

  it('treats a rejected request as finished, not in flight', () => {
    const { active } = resolveActiveRequest(
      [{ id: 'r', tenant_id: 't1', status: 'REJECTED' }],
      't1',
    );
    expect(active).toBeNull();
  });

  it('recognises legacy status spellings as still in flight', () => {
    const { active } = resolveActiveRequest(
      [{ id: 'legacy', tenant_id: 't1', status: 'VACATED' }],
      't1',
    );
    expect(active?.id).toBe('legacy');
  });

  it('survives a missing list', () => {
    expect(resolveActiveRequest(undefined, 't1')).toEqual({ active: null, lastCompleted: null });
  });
});

describe('decideLane', () => {
  it('sends a clean exit down the fast lane', () => {
    const d = decideLane({ preview: preview(), hasOpenDispute: false });
    expect(d.lane).toBe('FAST');
    expect(d.blockers).toEqual([]);
  });

  it('keeps a deposit refund in the fast lane — money moving is normal', () => {
    const d = decideLane({
      preview: preview({ net_settlement_amount: 5000, settlement_direction: 'OWNER_OWES_TENANT' }),
      hasOpenDispute: false,
    });
    expect(d.lane).toBe('FAST');
    expect(d.moneyMoves).toBe(true);
  });

  it('keeps unpaid dues in the fast lane too', () => {
    const d = decideLane({
      preview: preview({
        net_settlement_amount: -25000,
        settlement_direction: 'TENANT_OWES_OWNER',
        total_dues: 25000,
      }),
      hasOpenDispute: false,
    });
    expect(d.lane).toBe('FAST');
  });

  it('forces the full flow when a dispute is open', () => {
    const d = decideLane({ preview: preview(), hasOpenDispute: true });
    expect(d.lane).toBe('FULL');
    expect(d.blockers[0]).toMatch(/dispute/i);
  });

  it('forces the full flow when the owner wants to record damage', () => {
    const d = decideLane({ preview: preview(), hasOpenDispute: false, suspectsDamage: true });
    expect(d.lane).toBe('FULL');
  });

  it('forces the full flow when deductions are already on record', () => {
    const d = decideLane({ preview: preview({ total_deductions: 1200 }), hasOpenDispute: false });
    expect(d.lane).toBe('FULL');
  });

  it('refuses the fast lane when the settlement could not be calculated', () => {
    // Never offer one tap over a number we could not produce.
    const d = decideLane({ preview: null, hasOpenDispute: false });
    expect(d.lane).toBe('FULL');
  });

  it('does not call a rounding remainder "money moving"', () => {
    const d = decideLane({
      preview: preview({ net_settlement_amount: 0.004 }),
      hasOpenDispute: false,
    });
    expect(d.moneyMoves).toBe(false);
  });
});

describe('summariseSettlement', () => {
  it('says the owner refunds when the tenant is owed', () => {
    const s = summariseSettlement(preview({
      net_settlement_amount: 5000, settlement_direction: 'OWNER_OWES_TENANT',
    }));
    expect(s.ownerPays).toBe(true);
    expect(s.amount).toBe(5000);
    expect(s.headline).toMatch(/refund/i);
  });

  it('says the tenant owes when the tenant owes — and never calls it a refund', () => {
    // The bug this exists to prevent: the completion button said "Confirm
    // Refund & Complete" on an exit where ₹25,000 flowed the other way.
    const s = summariseSettlement(preview({
      net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
    }));
    expect(s.ownerPays).toBe(false);
    expect(s.amount).toBe(25000);
    expect(s.headline).not.toMatch(/refund/i);
  });

  it('reports a square settlement as nothing owed', () => {
    const s = summariseSettlement(preview());
    expect(s).toEqual({
      headline: 'Nothing owed either way', amount: 0, direction: 'SETTLED', ownerPays: false,
    });
  });

  it('treats a sub-paisa balance as square rather than a ₹0 refund', () => {
    const s = summariseSettlement(preview({
      net_settlement_amount: 0.004, settlement_direction: 'OWNER_OWES_TENANT',
    }));
    expect(s.direction).toBe('SETTLED');
  });

  it('survives a missing preview', () => {
    expect(summariseSettlement(null).direction).toBe('SETTLED');
  });
});

describe('completionLabel', () => {
  it('names the refund amount when the owner is paying out', () => {
    const s = summariseSettlement(preview({
      net_settlement_amount: 5000, settlement_direction: 'OWNER_OWES_TENANT',
    }));
    expect(completionLabel(s, 'RECOVERABLE', 0)).toBe('Refund ₹5,000 & close');
  });

  it('says the money is being kept on account, not refunded, when the tenant owes', () => {
    const s = summariseSettlement(preview({
      net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
    }));
    expect(completionLabel(s, 'RECOVERABLE', 25000)).toBe('Close & keep ₹25,000 on their account');
  });

  it('states the write-off in rupees when the owner chose to waive', () => {
    // The old flow did this silently behind a button labelled "Refund".
    const s = summariseSettlement(preview({
      net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
    }));
    expect(completionLabel(s, 'WAIVE', 25000)).toBe('Write off ₹25,000 & close');
  });

  it('does not claim a write-off when there is nothing outstanding', () => {
    const s = summariseSettlement(preview());
    expect(completionLabel(s, 'WAIVE', 0)).toBe('Complete move-out');
  });

  it('names the collected amount when the owner collects the full balance at close', () => {
    // The bug this exists to fix: collecting cost five taps because there was
    // no way to say "they paid me just now" from this screen at all.
    const s = summariseSettlement(preview({
      net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
    }));
    expect(completionLabel(s, 'COLLECT', 25000)).toBe('Collect ₹25,000 & close');
  });

  it('names only the partial amount when the owner only collected part of it', () => {
    const s = summariseSettlement(preview({
      net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
    }));
    expect(completionLabel(s, 'COLLECT', 25000, 8000)).toBe('Collect ₹8,000 & close');
  });

  it('does not claim a collection when there is nothing outstanding', () => {
    const s = summariseSettlement(preview());
    expect(completionLabel(s, 'COLLECT', 0)).toBe('Complete move-out');
  });

  it('never lets a mistakenly-oversized collected amount exceed what is owed', () => {
    const s = summariseSettlement(preview({
      net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
    }));
    expect(completionLabel(s, 'COLLECT', 25000, 99999)).toBe('Collect ₹25,000 & close');
  });
});

describe('buildConsequences', () => {
  const base = {
    tenantName: 'speakcode',
    roomNo: '105',
    outstandingDues: 0,
    duesDisposition: 'RECOVERABLE' as const,
    exitDateLabel: '26 Aug 2026',
    exitIsFuture: false,
  };

  it('tells the owner the bed frees up now for a same-day exit', () => {
    const lines = buildConsequences({ ...base, summary: summariseSettlement(preview()) });
    expect(lines.join(' ')).toMatch(/frees up immediately/);
    expect(lines.join(' ')).toMatch(/former tenant/);
  });

  it('tells the owner the bed is not free yet for a future exit', () => {
    const lines = buildConsequences({ ...base, exitIsFuture: true, summary: summariseSettlement(preview()) });
    const joined = lines.join(' ');
    expect(joined).toMatch(/frees up on 26 Aug 2026/);
    expect(joined).not.toMatch(/frees up immediately/);
    expect(joined).toMatch(/stays active until/);
  });

  it('warns that a write-off is permanent, and names the amount', () => {
    const lines = buildConsequences({
      ...base,
      outstandingDues: 25000,
      duesDisposition: 'WAIVE',
      summary: summariseSettlement(preview({
        net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
      })),
    });
    const joined = lines.join(' ');
    expect(joined).toMatch(/₹25,000 of unpaid rent is written off/);
    expect(joined).toMatch(/cannot be undone/);
  });

  it('promises the debt survives — and that nothing will chase it — when kept recoverable', () => {
    const lines = buildConsequences({
      ...base,
      outstandingDues: 25000,
      duesDisposition: 'RECOVERABLE',
      summary: summariseSettlement(preview({
        net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
      })),
    });
    const joined = lines.join(' ');
    expect(joined).toMatch(/stays on their account/);
    expect(joined).toMatch(/still collect it/);
    // Matches the backend: reminder-service and rent-generation both filter
    // status ACTIVE, so a former tenant accrues nothing further.
    expect(joined).toMatch(/No late fees or reminders/);
  });

  it('says nothing about dues when there are none', () => {
    const lines = buildConsequences({ ...base, summary: summariseSettlement(preview()) });
    expect(lines.join(' ')).not.toMatch(/unpaid rent/);
  });

  it('says the dues are recorded as paid in full when COLLECT covers the whole balance', () => {
    const lines = buildConsequences({
      ...base,
      outstandingDues: 25000,
      duesDisposition: 'COLLECT',
      summary: summariseSettlement(preview({
        net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
      })),
    });
    const joined = lines.join(' ');
    expect(joined).toMatch(/₹25,000 of unpaid rent is recorded as paid, right now/);
  });

  it('names both the collected amount and what remains when COLLECT is partial', () => {
    const lines = buildConsequences({
      ...base,
      outstandingDues: 25000,
      duesDisposition: 'COLLECT',
      collectedAmount: 8000,
      summary: summariseSettlement(preview({
        net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
      })),
    });
    const joined = lines.join(' ');
    expect(joined).toMatch(/₹8,000 of the ₹25,000 unpaid rent is recorded as paid now/);
    expect(joined).toMatch(/₹17,000 stays on their account/);
  });

  it('treats an omitted collected amount as the full outstanding balance', () => {
    const lines = buildConsequences({
      ...base,
      outstandingDues: 25000,
      duesDisposition: 'COLLECT',
      summary: summariseSettlement(preview({
        net_settlement_amount: -25000, settlement_direction: 'TENANT_OWES_OWNER',
      })),
    });
    expect(lines.join(' ')).not.toMatch(/stays on their account/);
  });

  it('always states what happens to the tenant’s access', () => {
    const lines = buildConsequences({ ...base, summary: summariseSettlement(preview()) });
    expect(lines.join(' ')).toMatch(/read-only access to their settlement/);
  });
});

describe('exitProgress', () => {
  it('numbers the four owner-visible steps', () => {
    expect(exitProgress('REQUESTED')).toMatchObject({ step: 1, total: 4 });
    expect(exitProgress('SETTLEMENT_PENDING')).toMatchObject({ step: 2 });
    expect(exitProgress('SETTLEMENT_APPROVED')).toMatchObject({ step: 3 });
    expect(exitProgress('PHYSICALLY_VACATED')).toMatchObject({ step: 4 });
  });

  it('collapses the pending-payment variant onto the same final step', () => {
    // To an owner these are one step; only the money differs.
    expect(exitProgress('SETTLEMENT_PENDING_PAYMENT').step)
      .toBe(exitProgress('PHYSICALLY_VACATED').step);
  });

  it('never exceeds the total it advertises', () => {
    expect(exitProgress('COMPLETED').step).toBeLessThanOrEqual(4);
  });

  it('maps legacy statuses onto their current step', () => {
    expect(exitProgress('APPROVED').step).toBe(exitProgress('SETTLEMENT_APPROVED').step);
  });
});

describe('canonicalStatus', () => {
  it('maps the pre-rename spellings forward', () => {
    expect(canonicalStatus('APPROVED')).toBe('SETTLEMENT_APPROVED');
    expect(canonicalStatus('VACATED')).toBe('PHYSICALLY_VACATED');
  });

  it('leaves current spellings alone and tolerates junk', () => {
    expect(canonicalStatus('REQUESTED')).toBe('REQUESTED');
    expect(canonicalStatus(null)).toBe('');
  });
});
