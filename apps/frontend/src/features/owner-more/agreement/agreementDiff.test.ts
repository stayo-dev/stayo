import { describe, expect, it } from 'vitest';
import { diffAgreementDocument, hasChanges } from './agreementDiff';
import type { AgreementDocument } from '@features/agreements/document/agreementDocument';

const doc = (sections: Array<[string, string]>): AgreementDocument => ({
  reference: 'x',
  contentHash: 'h',
  blocks: sections.map(([title, text], i) => ({
    kind: 'section',
    number: i + 1,
    title,
    clauses: [{ number: `${i + 1}`, text }],
    origin: 'owner',
    band: 'rules',
  })) as any,
  meta: {} as any,
});

describe('diffAgreementDocument', () => {
  it('reports nothing for an identical document', () => {
    const d = doc([['Fees', 'Due on the 5th.']]);
    expect(diffAgreementDocument(d, d)).toEqual({ added: [], removed: [], changed: [], unchanged: 1 });
  });

  it('names an added section', () => {
    expect(diffAgreementDocument(doc([['Fees', 'a']]), doc([['Fees', 'a'], ['Wi-Fi', 'b']])).added)
      .toEqual(['Wi-Fi']);
  });

  it('names a removed section', () => {
    expect(diffAgreementDocument(doc([['Fees', 'a'], ['Wi-Fi', 'b']]), doc([['Fees', 'a']])).removed)
      .toEqual(['Wi-Fi']);
  });

  it('names a reworded section as changed, not as an add plus a remove', () => {
    expect(diffAgreementDocument(doc([['Fees', 'a']]), doc([['Fees', 'b']])))
      .toMatchObject({ added: [], removed: [], changed: ['Fees'] });
  });

  it('is not confused by a section inserted above another', () => {
    // Keyed by title rather than number: inserting at the top must not report
    // every section below it as rewritten.
    const d = diffAgreementDocument(doc([['Fees', 'a']]), doc([['New', 'n'], ['Fees', 'a']]));
    expect(d).toMatchObject({ added: ['New'], changed: [], removed: [], unchanged: 1 });
  });

  it('treats everything as added when nothing is published yet', () => {
    expect(diffAgreementDocument(null, doc([['Fees', 'a']])).added).toEqual(['Fees']);
  });

  it('counts sections that did not move', () => {
    expect(diffAgreementDocument(doc([['Fees', 'a'], ['Wi-Fi', 'b']]), doc([['Fees', 'a'], ['Wi-Fi', 'c']])).unchanged)
      .toBe(1);
  });

  it('survives a document that has not loaded', () => {
    expect(diffAgreementDocument(null, null)).toEqual({ added: [], removed: [], changed: [], unchanged: 0 });
  });
});

describe('hasChanges', () => {
  it('is false when only unchanged sections are counted', () => {
    expect(hasChanges({ added: [], removed: [], changed: [], unchanged: 7 })).toBe(false);
  });

  it('is true for any of the three kinds of change', () => {
    expect(hasChanges({ added: ['a'], removed: [], changed: [], unchanged: 0 })).toBe(true);
    expect(hasChanges({ added: [], removed: ['a'], changed: [], unchanged: 0 })).toBe(true);
    expect(hasChanges({ added: [], removed: [], changed: ['a'], unchanged: 0 })).toBe(true);
  });
});
