import { describe, expect, it, vi } from 'vitest';
import { bulkResend, describeBulkResend, type ResendOutcome } from './bulkResend';

const t = (name: string) => ({ name });

describe('bulkResend', () => {
  it('sends one at a time, in order', async () => {
    const order: string[] = [];
    let inFlight = 0;
    const send = vi.fn(async (x: { name: string }): Promise<ResendOutcome> => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      order.push(x.name);
      await Promise.resolve();
      inFlight -= 1;
      return 'delivered';
    });
    await bulkResend([t('A'), t('B'), t('C')], send);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('sorts each tenant by outcome, and a throw counts as failed without stopping the rest', async () => {
    const outcomes: Record<string, ResendOutcome | 'throw'> = { A: 'delivered', B: 'not-delivered', C: 'throw', D: 'delivered' };
    const result = await bulkResend([t('A'), t('B'), t('C'), t('D')], async (x) => {
      const o = outcomes[x.name];
      if (o === 'throw') throw new Error('network');
      return o;
    });
    expect(result.delivered.map((x) => x.name)).toEqual(['A', 'D']);
    expect(result.notDelivered.map((x) => x.name)).toEqual(['B']);
    expect(result.failed.map((x) => x.name)).toEqual(['C']);
  });

  it('reports progress after each send', async () => {
    const progress: Array<[number, number]> = [];
    await bulkResend([t('A'), t('B')], async () => 'delivered', (d, n) => progress.push([d, n]));
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });
});

describe('describeBulkResend', () => {
  it('says how many went out', () => {
    expect(describeBulkResend({ delivered: [t('A'), t('B')], notDelivered: [], failed: [] })).toBe('New link sent to 2 tenants.');
  });
  it('names who still needs a hand, capped at three names', () => {
    const msg = describeBulkResend({
      delivered: [t('A')],
      notDelivered: [t('B'), t('C'), t('D'), t('E')],
      failed: [t('F')],
    });
    expect(msg).toContain('New link sent to 1 tenant.');
    expect(msg).toContain('B, C, D and 1 more');
    expect(msg).toContain("Couldn't resend to F");
  });
});
