import { describe, expect, it } from 'vitest';
import { canRestore, publishedLabel, restoreConfirmation, signedLabel } from './versionHistory';

describe('signedLabel', () => {
  it('makes a version concrete by naming who holds it', () => {
    expect(signedLabel(23)).toBe('23 tenants signed this');
  });

  it('uses the singular for one', () => {
    expect(signedLabel(1)).toBe('1 tenant signed this');
  });

  it('says plainly when nobody signed, rather than showing a bare zero', () => {
    expect(signedLabel(0)).toBe('No tenants signed this version');
    expect(signedLabel(-1)).toBe('No tenants signed this version');
  });
});

describe('publishedLabel', () => {
  it('formats the way the rest of the owner app formats dates', () => {
    // Day, short month, year — matched by shape, not by the exact
    // abbreviation: ICU renders September as "Sep" or "Sept" depending on the
    // locale data the runtime ships, and the browser need not agree with Node.
    expect(publishedLabel('2026-09-12T08:30:00.000Z')).toMatch(/^Published 12 \w+ 2026$/);
  });

  it('gives nothing rather than "Invalid Date" for missing or broken input', () => {
    expect(publishedLabel(null)).toBeNull();
    expect(publishedLabel(undefined)).toBeNull();
    expect(publishedLabel('not a date')).toBeNull();
  });
});

describe('canRestore', () => {
  it('offers nothing on the version that is already live', () => {
    expect(canRestore({ is_live: true })).toBe(false);
    expect(canRestore({ is_live: false })).toBe(true);
  });
});

/**
 * The most load-bearing sentences in the feature. An owner reverting a legal
 * document is asking "what does this break?", and the answer has to arrive
 * before any warning does.
 */
describe('restoreConfirmation', () => {
  const plain = restoreConfirmation({ versionNumber: 2, hasDraftEdits: false });

  it('names the version in the question', () => {
    expect(plain.title).toBe("Use version 2's wording?");
  });

  it('leads with the fact that nothing changes for tenants yet', () => {
    expect(plain.lines[0]).toContain('nothing changes for tenants until you publish');
  });

  it('answers the real fear second, before any cost', () => {
    expect(plain.lines[1]).toContain('No signed agreement is affected');
  });

  it('says nothing about a draft when there is no draft to lose', () => {
    expect(plain.lines).toHaveLength(2);
    expect(plain.lines.join(' ')).not.toContain('replaced');
  });

  it('states the one real cost last, and only when it applies', () => {
    const withDraft = restoreConfirmation({ versionNumber: 2, hasDraftEdits: true });
    expect(withDraft.lines).toHaveLength(3);
    expect(withDraft.lines[2]).toContain('will be replaced');
  });

  it('labels the button by where the wording lands, not by the act', () => {
    // "Restore" would imply the live document had already changed.
    expect(plain.confirmLabel).toBe('Load into draft');
  });
});
