import { describe, expect, it } from 'vitest';
import {
  CLOSURE_REASONS,
  CONFIRM_PHRASE,
  canClose,
  closureBlocker,
  confirmPhraseMatches,
  retentionOffer,
  whatYouLose,
} from './accountClosure';

const clear = { hasLiveTenancy: false, outstandingPaise: 0, moveOutPending: false };

describe('what stands in the way', () => {
  it('lets a settled account through', () => {
    expect(closureBlocker(clear)).toBeNull();
  });

  it('asks for money before anything else', () => {
    // Telling someone to move out while they owe rent just sends them back here.
    const blocker = closureBlocker({ ...clear, hasLiveTenancy: true, outstandingPaise: 500000, moveOutPending: true });
    expect(blocker?.kind).toBe('OUTSTANDING_DUES');
  });

  it('waits for a settlement already under way', () => {
    const blocker = closureBlocker({ ...clear, hasLiveTenancy: true, moveOutPending: true });
    expect(blocker?.kind).toBe('PENDING_MOVE_OUT');
  });

  it('names the hostel someone still lives at', () => {
    const blocker = closureBlocker({ ...clear, hasLiveTenancy: true, hostelName: 'Sri Sai Residency' });
    expect(blocker?.kind).toBe('LIVE_TENANCY');
    expect(blocker?.title).toContain('Sri Sai Residency');
  });

  it('still says something useful with no hostel name', () => {
    const blocker = closureBlocker({ ...clear, hasLiveTenancy: true });
    expect(blocker?.title).toContain('your hostel');
  });

  it('gives every blocker a way forward', () => {
    for (const context of [
      { ...clear, outstandingPaise: 1 },
      { ...clear, moveOutPending: true },
      { ...clear, hasLiveTenancy: true },
    ]) {
      expect(closureBlocker(context)?.action?.to).toBeTruthy();
    }
  });
});

describe('what you lose', () => {
  it('counts in the person’s own numbers', () => {
    const items = whatYouLose({ stays: 2, months: 14, savedHostels: 3, documents: 4, enquiries: 1 });
    const history = items.find((i) => i.label === 'Your stay history');
    expect(history?.detail).toContain('2 stays');
    expect(history?.detail).toContain('14 months');
  });

  it('never warns about losing nothing', () => {
    // Padding the list with zeroes teaches the reader we are padding.
    const items = whatYouLose({ stays: 0, months: 0, savedHostels: 0, documents: 0, enquiries: 0 });
    expect(items.map((i) => i.label)).toEqual(['This email and phone']);
  });

  it('always says the contact details are freed', () => {
    const items = whatYouLose({ stays: 5, months: 30, savedHostels: 2, documents: 2, enquiries: 2 });
    expect(items[items.length - 1].label).toBe('This email and phone');
  });

  it('gets singulars right', () => {
    const items = whatYouLose({ stays: 1, months: 1, savedHostels: 1, documents: 1, enquiries: 1 });
    const joined = items.map((i) => i.detail).join(' ');
    expect(joined).toContain('1 stay —');
    expect(joined).toContain('1 month');
    expect(joined).not.toContain('1 documents');
    expect(joined).not.toContain('1 places');
  });
});

describe('the offer on the way out', () => {
  it('offers a smaller fix where one honestly exists', () => {
    expect(retentionOffer('TOO_MANY_MESSAGES')?.action?.to).toBe('/profile/tickets');
    expect(retentionOffer('HARD_TO_USE')).not.toBeNull();
    expect(retentionOffer('BAD_EXPERIENCE')).not.toBeNull();
  });

  it('says nothing to someone it cannot help', () => {
    // Arguing with someone who has moved home is what makes a flow feel like a trap.
    expect(retentionOffer('MOVED_HOME')).toBeNull();
    expect(retentionOffer('FOUND_ELSEWHERE')).toBeNull();
    expect(retentionOffer('OTHER')).toBeNull();
  });

  it('stays silent for at least a third of the reasons', () => {
    const silent = CLOSURE_REASONS.filter((reason) => retentionOffer(reason.id) === null);
    expect(silent.length).toBeGreaterThanOrEqual(3);
  });

  it('never begs — no offer is only a plea to stay', () => {
    for (const reason of CLOSURE_REASONS) {
      const offer = retentionOffer(reason.id);
      if (!offer) continue;
      expect(offer.body.toLowerCase()).not.toContain('please stay');
      expect(offer.body.toLowerCase()).not.toContain('are you sure');
    }
  });

  it('keeps "Something else" last so the list stays scannable', () => {
    expect(CLOSURE_REASONS[CLOSURE_REASONS.length - 1].id).toBe('OTHER');
  });
});

describe('confirming', () => {
  it('accepts the phrase in any case, with stray spaces', () => {
    expect(confirmPhraseMatches('delete')).toBe(true);
    expect(confirmPhraseMatches('  DELETE  ')).toBe(true);
    expect(confirmPhraseMatches(CONFIRM_PHRASE)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(confirmPhraseMatches('')).toBe(false);
    expect(confirmPhraseMatches('del')).toBe(false);
    expect(confirmPhraseMatches('delete my account')).toBe(false);
  });

  it('needs a reason and the phrase, not one or the other', () => {
    expect(canClose({ reason: 'MOVED_HOME', note: '' }, 'DELETE')).toBe(true);
    expect(canClose({ reason: '', note: 'a long explanation' }, 'DELETE')).toBe(false);
    expect(canClose({ reason: 'MOVED_HOME', note: '' }, 'nope')).toBe(false);
  });

  it('does not demand a written note', () => {
    // Forcing prose on the way out yields "asdf" and teaches us nothing.
    expect(canClose({ reason: 'OTHER', note: '' }, 'DELETE')).toBe(true);
  });
});
