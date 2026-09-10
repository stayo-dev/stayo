import { describe, expect, it } from 'vitest';
import { refundsDocument } from './refunds';
import { termsDocument } from './terms';
import { legalDocuments } from './index';
import type { LegalDocument } from './types';
import { PAYMENT_PARTNER } from '../company';

const text = () => JSON.stringify(refundsDocument.content);

/** The blocks from one subheading up to the next, as text. Empty if the id is missing. */
function sectionText(doc: LegalDocument, subheadingId: string): string {
  const start = doc.content.findIndex((b) => b.type === 'subheading' && b.id === subheadingId);
  if (start === -1) return '';
  const rest = doc.content.slice(start + 1);
  const next = rest.findIndex((b) => b.type === 'subheading');
  return JSON.stringify(next === -1 ? rest : rest.slice(0, next));
}

describe('Payments, Refunds & Cancellations', () => {
  it('keeps its old URLs alive — aggregators may have registered them', () => {
    expect(refundsDocument.route).toBe('/legal/refunds');
    expect(refundsDocument.aliases).toEqual(expect.arrayContaining(['/refund-policy', '/legal/refund-policy']));
  });

  /*
   * The governing rule of this document (spec §6.4): Stayo never receives,
   * holds, refunds or reverses resident money, so no sentence may promise it
   * will. The earlier version of this test matched two exact phrasings and let
   * "Stayo will reimburse you" or "we will credit it back" through.
   *
   * Two checks, because Part 1 covers subscription money Stayo DOES receive,
   * where "we will refund" can be legitimate:
   *  - inside the sections about resident money, any refund-type promise with
   *    Stayo or "we" as the subject is forbidden;
   *  - across every document, a Stayo promise naming resident money is forbidden.
   */
  it('never promises, in the resident-money sections, that Stayo will return money', () => {
    const REFUND_PROMISE =
      /\b(we|stayo)\s+(will|shall|can|may|would)\s+(refund|reimburse|repay|pay you back|credit (it |the amount |your money )?back|return your (money|rent|deposit))/i;
    const residentMoney = [
      sectionText(refundsDocument, 'money-you-pay-a-hostel'),
      sectionText(termsDocument, 'schedule-b'),
    ];
    for (const section of residentMoney) {
      expect(section.length).toBeGreaterThan(0);
      expect(section).not.toMatch(REFUND_PROMISE);
    }
  });

  it('never promises, in any document, that Stayo will refund rent, a deposit or a booking token', () => {
    const RESIDENT_MONEY_PROMISE =
      /\b(we|stayo)\s+(will|shall|can|may|would)\s+(refund|reimburse|repay|return)\s+(your\s+|the\s+)?(rent|deposit|security deposit|booking token|token)/i;
    for (const doc of legalDocuments) {
      expect(JSON.stringify(doc.content), doc.id).not.toMatch(RESIDENT_MONEY_PROMISE);
    }
  });

  it('states that resident payments settle directly to the hostel', () => {
    expect(text()).toMatch(/directly to the (hostel|hostel's)/i);
  });

  it('states the enforcement remedy for the refund floor, not a Stayo guarantee', () => {
    expect(text()).toMatch(/suspend|delist/i);
  });

  it('carries the three floor guarantees', () => {
    expect(text()).toMatch(/duplicate/i);
    expect(text()).toMatch(/wrong amount|incorrect amount/i);
    expect(text()).toMatch(/booking token|token/i);
  });

  it('describes the aggregator without naming it', () => {
    expect(text()).toContain(PAYMENT_PARTNER.descriptor);
    expect(text()).not.toContain(PAYMENT_PARTNER.name);
    expect(text()).not.toContain('Razorpay');
  });

  it('scopes itself explicitly out of hostel-to-resident money, as RentOk does', () => {
    expect(text()).toMatch(/security deposit/i);
    expect(text()).toMatch(/does not apply|not covered by this policy/i);
  });

  it('does not promise an end-to-end refund date it cannot control', () => {
    expect(text()).toMatch(/bank|card issuer|UPI/i);
  });

  it('does not repeat the retired 7-to-10-business-day promise', () => {
    expect(text()).not.toMatch(/7 to 10 business days/i);
  });

  it('separates subscription money from resident money', () => {
    const ids = refundsDocument.content.filter((b) => b.type === 'subheading').map((b: any) => b.id);
    expect(ids).toContain('money-you-pay-stayo');
    expect(ids).toContain('money-you-pay-a-hostel');
  });
});
