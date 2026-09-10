import { describe, expect, it } from 'vitest';
import { cookiesDocument } from './cookies';
import { serviceDeliveryDocument } from './serviceDelivery';

describe('the Cookie Notice', () => {
  it('exists, closing the footer link that previously pointed at the privacy page', () => {
    expect(cookiesDocument.route).toBe('/legal/cookies');
  });

  it('states the cookies are strictly necessary, which is why no consent banner is shown', () => {
    expect(JSON.stringify(cookiesDocument.content)).toMatch(/strictly necessary|essential/i);
  });

  it('claims no analytics or advertising cookies, matching the verified absence of any', () => {
    expect(JSON.stringify(cookiesDocument.content)).not.toMatch(/Google Analytics|advertising cookies we set/i);
  });
});

describe('the Service Delivery policy', () => {
  it('keeps the shipping-policy URLs alive for aggregator checklists', () => {
    expect(serviceDeliveryDocument.route).toBe('/legal/service-delivery');
    expect(serviceDeliveryDocument.aliases).toEqual(
      expect.arrayContaining(['/shipping-policy', '/legal/shipping-policy']),
    );
  });

  it('states that no physical goods are shipped', () => {
    expect(JSON.stringify(serviceDeliveryDocument.content)).toMatch(/no physical (goods|products)/i);
  });
});
