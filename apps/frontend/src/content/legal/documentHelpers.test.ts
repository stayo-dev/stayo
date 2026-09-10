import { describe, expect, it } from 'vitest';
import type { LegalDocument } from './types';
import { documentAnchors, documentIdForPath, allRoutes, validateRegistry } from './documentHelpers';

const doc = (over: Partial<LegalDocument> = {}): LegalDocument => ({
  id: 'terms',
  title: 'Terms of Use',
  route: '/legal/terms',
  aliases: ['/terms'],
  version: '1.0',
  effectiveDate: '2026-09-10',
  summary: ['Stayo is a platform, not your landlord.'],
  audience: 'all',
  material: true,
  metaDescription: 'Terms of Use for the Stayo platform.',
  content: [
    { type: 'subheading', id: 'scope', text: 'Scope' },
    { type: 'clause', id: 'clause-1-1', number: '1.1', text: 'These terms apply to everyone.' },
    { type: 'paragraph', text: 'Not an anchor.' },
  ],
  ...over,
});

describe('documentAnchors', () => {
  it('extracts subheadings and clauses, ignoring prose', () => {
    expect(documentAnchors(doc())).toEqual([
      { id: 'scope', text: 'Scope', level: 'section' },
      { id: 'clause-1-1', text: '1.1', level: 'clause' },
    ]);
  });
});

describe('documentIdForPath', () => {
  const docs = [doc(), doc({ id: 'privacy', route: '/legal/privacy', aliases: ['/privacy'] })];

  it('resolves a canonical route', () => {
    expect(documentIdForPath('/legal/terms', docs)).toBe('terms');
  });

  it('resolves an alias, because old URLs stay registered with aggregators', () => {
    expect(documentIdForPath('/terms', docs)).toBe('terms');
    expect(documentIdForPath('/privacy', docs)).toBe('privacy');
  });

  it('ignores a trailing slash', () => {
    expect(documentIdForPath('/legal/privacy/', docs)).toBe('privacy');
  });

  it('returns null for the hub and for anything unknown', () => {
    expect(documentIdForPath('/legal', docs)).toBeNull();
    expect(documentIdForPath('/nope', docs)).toBeNull();
  });
});

describe('allRoutes', () => {
  it('returns canonical routes and aliases together', () => {
    expect(allRoutes([doc()])).toEqual(['/legal/terms', '/terms']);
  });
});

describe('validateRegistry', () => {
  it('passes a well-formed registry', () => {
    expect(validateRegistry([doc()])).toEqual([]);
  });

  it('rejects a missing version, effective date or summary', () => {
    expect(validateRegistry([doc({ version: '' })])).toContain('terms: missing version');
    expect(validateRegistry([doc({ effectiveDate: '' })])).toContain('terms: missing effectiveDate');
    expect(validateRegistry([doc({ summary: [] })])).toContain('terms: missing summary');
  });

  it('rejects a non-ISO effective date, so sorting and display cannot drift', () => {
    expect(validateRegistry([doc({ effectiveDate: 'June 2026' })])).toContain(
      'terms: effectiveDate must be ISO yyyy-mm-dd',
    );
  });

  it('rejects two documents claiming the same route', () => {
    const clash = [doc(), doc({ id: 'other', aliases: [] })];
    expect(validateRegistry(clash)).toContain('/legal/terms: claimed by more than one document');
  });

  it('rejects a duplicate anchor id, which would break deep links', () => {
    const dupe = doc({
      content: [
        { type: 'subheading', id: 'scope', text: 'Scope' },
        { type: 'subheading', id: 'scope', text: 'Scope again' },
      ],
    });
    expect(validateRegistry([dupe])).toContain('terms: duplicate anchor id "scope"');
  });
});
