import { describe, it, expect } from 'vitest';
import {
  LOST_REASON_LABEL, stageChips, nextStage, canAdvance, leadPipelineStats, formatLostReasons,
} from './leadPipeline';

describe('stageChips', () => {
  it('offers every stage plus an all filter, with counts', () => {
    const chips = stageChips({ NEW: 5, CONTACTED: 3, DEMO: 1, NEGOTIATING: 2, LIVE: 4, LOST: 6 });
    expect(chips[0]).toMatchObject({ key: 'all', label: 'All' });
    expect(chips[0].count).toBe(21);
    expect(chips.find((c) => c.key === 'DEMO')?.count).toBe(1);
  });

  it('shows a zero count rather than hiding an empty stage — an empty stage is information', () => {
    const chips = stageChips({ NEW: 2 });
    expect(chips.find((c) => c.key === 'NEGOTIATING')?.count).toBe(0);
  });
});

describe('nextStage / canAdvance', () => {
  it('walks the admin-driven stages in order', () => {
    expect(nextStage('NEW')).toBe('CONTACTED');
    expect(nextStage('CONTACTED')).toBe('DEMO');
    expect(nextStage('DEMO')).toBe('NEGOTIATING');
  });

  it('stops at NEGOTIATING — approving is a separate action with real side effects', () => {
    expect(nextStage('NEGOTIATING')).toBeNull();
    expect(canAdvance('NEGOTIATING')).toBe(false);
  });

  it('treats legacy UNDER_REVIEW as CONTACTED', () => {
    expect(nextStage('UNDER_REVIEW')).toBe('DEMO');
  });

  it('refuses to advance a system-driven or dead lead', () => {
    for (const status of ['APPROVED', 'INVITE_SENT', 'OWNER_ACTIVATED', 'LIVE', 'LOST']) {
      expect(canAdvance(status)).toBe(false);
    }
  });
});

describe('leadPipelineStats', () => {
  const counts = { NEW: 10, CONTACTED: 5, DEMO: 3, NEGOTIATING: 2, LIVE: 4, LOST: 6, INVITE_SENT: 1 };

  it('counts open leads as those still being worked, excluding won and lost', () => {
    expect(leadPipelineStats(counts).find((s) => s.key === 'open')?.value).toBe('21');
  });

  it('reports conversion against every lead ever captured', () => {
    expect(leadPipelineStats(counts).find((s) => s.key === 'conversion')?.value).toBe('12.9%');
  });

  it('shows a dash instead of NaN when there are no leads', () => {
    expect(leadPipelineStats({}).find((s) => s.key === 'conversion')?.value).toBe('—');
  });
});

describe('formatLostReasons', () => {
  it('turns enum values into readable labels and sizes the bars', () => {
    const rows = formatLostReasons([
      { reason: 'PRICE', count: 8 },
      { reason: 'NOT_READY', count: 4 },
    ]);
    expect(rows[0].label).toBe(LOST_REASON_LABEL.PRICE);
    expect(rows[0].width).toBe('100%');
    expect(rows[1].width).toBe('50%');
  });

  it('handles an empty set without dividing by zero', () => {
    expect(formatLostReasons([])).toEqual([]);
  });

  it('falls back to the raw value for an unknown reason rather than rendering blank', () => {
    expect(formatLostReasons([{ reason: 'MYSTERY', count: 1 }])[0].label).toBe('MYSTERY');
  });
});
