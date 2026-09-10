import { describe, expect, it } from 'vitest';
import { refundsDocument } from './refunds';
import { PAYMENT_PARTNER } from '../company';

const text = () => JSON.stringify(refundsDocument.content);

describe('Payments, Refunds & Cancellations', () => {
  it('keeps its old URLs alive — aggregators may have registered them', () => {
    expect(refundsDocument.route).toBe('/legal/refunds');
    expect(refundsDocument.aliases).toEqual(expect.arrayContaining(['/refund-policy', '/legal/refund-policy']));
  });

  it('never promises that Stayo refunds resident money it never receives', () => {
    expect(text()).not.toMatch(/we will refund your rent|Stayo will refund your (rent|deposit)/i);
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
