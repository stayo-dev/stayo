import { describe, expect, it } from 'vitest';
import { legalDocuments } from './index';
import { validateRegistry, documentIdForPath } from './documentHelpers';
import { PAYMENT_PARTNER } from '../company';

describe('the published legal registry', () => {
  it('satisfies every structural rule', () => {
    expect(validateRegistry(legalDocuments)).toEqual([]);
  });

  it('carries no unresolved placeholder in any published string', () => {
    const text = JSON.stringify(legalDocuments);
    expect(text).not.toMatch(/\bTBD\b|\bTODO\b|\[PROPRIETOR|\[ADDRESS|XXX/i);
  });

  it('never claims a GSTIN, because the proprietorship is not GST-registered', () => {
    expect(JSON.stringify(legalDocuments)).not.toMatch(/gstin/i);
  });

  it('names no payment provider at all — published copy describes, never names', () => {
    const text = JSON.stringify(legalDocuments);
    for (const provider of [
      PAYMENT_PARTNER.name, 'Razorpay', 'PhonePe', 'Cashfree', 'Paytm', 'PayU', 'CCAvenue', 'Stripe',
    ]) {
      expect(text).not.toContain(provider);
    }
    expect(text).toContain(PAYMENT_PARTNER.descriptor);
  });

  it('resolves every route and alias it declares', () => {
    for (const doc of legalDocuments) {
      for (const route of [doc.route, ...doc.aliases]) {
        expect(documentIdForPath(route, legalDocuments)).toBe(doc.id);
      }
    }
  });
});

describe('the Terms of Use', () => {
  const terms = legalDocuments.find((d) => d.id === 'terms')!;

  it('is registered', () => {
    expect(terms).toBeDefined();
    expect(terms.route).toBe('/legal/terms');
    expect(terms.aliases).toContain('/terms');
  });

  it('states jurisdiction as non-exclusive — an exclusive clause without nexus is void', () => {
    const text = JSON.stringify(terms.content);
    expect(text).toContain('Hyderabad');
    expect(text).not.toMatch(/shall have exclusive jurisdiction/i);
    expect(text).toMatch(/shall have jurisdiction/i);
  });

  it('states that Stayo earns nothing from resident rent', () => {
    expect(JSON.stringify(terms.content)).toMatch(/earns? nothing from your rent/i);
  });

  it('requires account holders to be 18 or over', () => {
    expect(JSON.stringify(terms.content)).toMatch(/18/);
  });

  it('carries both schedules', () => {
    const ids = terms.content.filter((b) => b.type === 'subheading').map((b: any) => b.id);
    expect(ids).toContain('schedule-a');
    expect(ids).toContain('schedule-b');
  });
});
