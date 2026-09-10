import { describe, expect, it } from 'vitest';
// `?raw` reads the route table as text through Vite, with no Node APIs, so this
// typechecks under the app's own tsconfig (which has no Node types).
import source from '../../app/router/PublicRoutes.tsx?raw';
import { legalDocuments, allRoutes } from './index';

/**
 * Guards the failure this replaced: the route table and the page's own path
 * matching were edited separately, so a route could exist with nothing
 * rendering it, or a document could declare a URL no router served.
 */
describe('public routing for legal documents', () => {
  it('serves every route and alias the registry declares', () => {
    for (const route of allRoutes(legalDocuments)) {
      expect(source).toContain(`path="${route}"`);
    }
  });

  it('still serves the legal hub', () => {
    expect(source).toContain('path="/legal"');
  });

  it('declares every legacy URL that was previously live', () => {
    for (const legacy of [
      '/terms', '/privacy', '/refund-policy', '/shipping-policy',
      '/legal/terms', '/legal/privacy', '/legal/refund-policy',
      '/legal/shipping-policy', '/legal/contact', '/legal/data-deletion',
    ]) {
      expect(allRoutes(legalDocuments).concat('/legal')).toContain(legacy);
    }
  });
});
