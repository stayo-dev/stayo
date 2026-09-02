import { describe, expect, it } from 'vitest';
import { paidAmountGuidance, formatRupees } from './paidAmountGuidance';

describe('paidAmountGuidance', () => {
  it('says nothing at all until the preview has answered', () => {
    // Silence beats a guessed number when the subject is money.
    const g = paidAmountGuidance(15000, null);
    expect(g.state).toBe('unknown');
    expect(g.owedLabel).toBeNull();
    expect(g.isBlocking).toBe(false);
  });

  it('anchors the field with what is owed, before anything is typed', () => {
    const g = paidAmountGuidance('', 15000);
    expect(g.owedLabel).toBe('₹15,000 owed today');
    expect(g.fillAmount).toBe(15000);
    expect(g.state).toBe('none');
    expect(g.message).toBeNull();
  });

  it('reports what remains when the tenant paid part of it', () => {
    const g = paidAmountGuidance(8000, 15000);
    expect(g.state).toBe('partial');
    expect(g.message).toBe('₹7,000 will still be owed.');
    expect(g.isBlocking).toBe(false);
  });

  it('confirms a payment that settles everything', () => {
    const g = paidAmountGuidance(15000, 15000);
    expect(g.state).toBe('exact');
    expect(g.message).toBe('Settles everything owed today.');
    expect(g.isBlocking).toBe(false);
  });

  it('blocks an amount larger than what is owed, and says by how much', () => {
    // This is the refusal the server issues. Said here, beside the field, it
    // is a correction; said at the final step it was a dead end.
    const g = paidAmountGuidance(20000, 15000);
    expect(g.state).toBe('over');
    expect(g.isBlocking).toBe(true);
    expect(g.message).toBe('That is ₹5,000 more than is owed. Record ₹15,000 or less.');
  });

  it('handles a tenant who owes nothing yet', () => {
    const g = paidAmountGuidance(500, 0);
    expect(g.owedLabel).toBe('Nothing is owed yet');
    expect(g.fillAmount).toBeNull();
    expect(g.isBlocking).toBe(true);
  });

  it('does not read a rounded figure as an overpayment', () => {
    // The label rounds for display; the comparison must not punish that.
    expect(paidAmountGuidance(15000, 14999.995).state).toBe('exact');
  });

  it('treats a blank, zero or junk amount as nothing entered', () => {
    for (const value of ['', null, undefined, 0, 'abc']) {
      const g = paidAmountGuidance(value as any, 15000);
      expect(g.state).toBe('none');
      expect(g.isBlocking).toBe(false);
    }
  });

  it('groups rupees the Indian way', () => {
    expect(formatRupees(1500000)).toBe('₹15,00,000');
    expect(formatRupees(8000)).toBe('₹8,000');
  });
});
