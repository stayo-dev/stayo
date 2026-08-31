import { describe, it, expect } from 'vitest';
import {
  editLine,
  addLine,
  removeLine,
  moveLine,
  renameSection,
  toggleSection,
  isSectionEnabled,
  toggleImportant,
  resetSection,
  variablesUsed,
  unknownVariables,
  fillVariables,
  hasDraftChanges,
  countEnabledLines,
} from './agreementDraft';
import type { RulesContent } from './agreements';

const content = (): RulesContent => ({
  categories: [
    {
      id: 'fees',
      title: 'Fee Structure & Payment Policy',
      severity: 'important',
      rules: [
        'Hostel fee is applicable only for the academic year period of 12 months.',
        'Hostel fees once paid are strictly non-refundable.',
        'Students pay monthly rent of ₹{MONTHLY_RENT}.',
      ],
    },
    {
      id: 'facilities',
      title: 'Accommodation & Hostel Facilities',
      severity: 'standard',
      rules: ['Wi-Fi and hot water are provided free of cost.'],
    },
  ],
});

const rulesOf = (c: RulesContent, id: string) => c.categories?.find((x) => x.id === id)?.rules ?? [];

/**
 * This edits a document tenants sign. A mistake is not a broken screen — it is
 * a clause silently missing from an agreement somebody already signed.
 */
describe('editLine', () => {
  it('replaces one line and leaves its neighbours alone', () => {
    const next = editLine(content(), 'fees', 1, 'Fees are refundable within 7 days.');
    expect(rulesOf(next, 'fees')[1]).toBe('Fees are refundable within 7 days.');
    expect(rulesOf(next, 'fees')[0]).toBe(content().categories![0].rules![0]);
    expect(rulesOf(next, 'fees')).toHaveLength(3);
  });

  it('leaves other sections untouched', () => {
    const next = editLine(content(), 'fees', 0, 'Changed.');
    expect(rulesOf(next, 'facilities')).toEqual(rulesOf(content(), 'facilities'));
  });

  it('refuses to blank a line — deleting is a separate, deliberate act', () => {
    expect(editLine(content(), 'fees', 0, '   ')).toEqual(content());
  });

  it('never mutates the input', () => {
    // The draft is compared against the published version to decide whether
    // there is anything to save; mutating would make that always say "no".
    const original = content();
    editLine(original, 'fees', 0, 'Changed.');
    expect(original.categories![0].rules![0]).toBe(content().categories![0].rules![0]);
  });
});

describe('addLine and removeLine', () => {
  it('inserts after the given line', () => {
    const next = addLine(content(), 'fees', 0, 'New clause.');
    expect(rulesOf(next, 'fees')[1]).toBe('New clause.');
    expect(rulesOf(next, 'fees')).toHaveLength(4);
  });

  it('inserts at the top when told to', () => {
    expect(rulesOf(addLine(content(), 'fees', -1, 'First.'), 'fees')[0]).toBe('First.');
  });

  it('removes exactly one line', () => {
    const next = removeLine(content(), 'fees', 1);
    expect(rulesOf(next, 'fees')).toHaveLength(2);
    expect(rulesOf(next, 'fees')[1]).toContain('MONTHLY_RENT');
  });
});

describe('moveLine', () => {
  it('swaps a line with its neighbour', () => {
    const next = moveLine(content(), 'fees', 0, 1);
    expect(rulesOf(next, 'fees')[0]).toContain('non-refundable');
    expect(rulesOf(next, 'fees')[1]).toContain('academic year');
  });

  it('does nothing at the edges rather than wrapping around', () => {
    expect(moveLine(content(), 'fees', 0, -1)).toEqual(content());
    expect(moveLine(content(), 'fees', 2, 1)).toEqual(content());
  });

  it('keeps a line inside its own section', () => {
    // Order carries meaning: "the following applies to clause 3" stops making
    // sense if 3 moves to another section.
    const next = moveLine(content(), 'fees', 2, 1);
    expect(rulesOf(next, 'facilities')).toHaveLength(1);
  });
});

describe('sections', () => {
  it('renames, and refuses an empty title', () => {
    expect(renameSection(content(), 'fees', 'Fees').categories![0].title).toBe('Fees');
    expect(renameSection(content(), 'fees', '  ')).toEqual(content());
  });

  it('excludes a section without losing its text', () => {
    // An owner who drops "Pets" this year and wants it back next year should
    // not have to retype it.
    const off = toggleSection(content(), 'fees');
    expect(isSectionEnabled(off.categories![0])).toBe(false);
    expect(off.categories![0].rules).toHaveLength(3);
    expect(isSectionEnabled(toggleSection(off, 'fees').categories![0])).toBe(true);
  });

  it('treats a missing enabled flag as included', () => {
    // Templates written before the flag existed have no flag.
    expect(isSectionEnabled({ id: 'x', title: 'X' })).toBe(true);
  });

  it('toggles importance, which is what surfaces a section to tenants', () => {
    expect(toggleImportant(content(), 'fees').categories![0].severity).toBe('standard');
    expect(toggleImportant(content(), 'facilities').categories![1].severity).toBe('important');
  });
});

describe('resetSection', () => {
  const defaults = (): RulesContent => ({
    categories: [{ id: 'fees', title: 'Fees', rules: ["Stayo's own wording."] }],
  });

  it("restores one section to Stayo's wording", () => {
    const edited = editLine(content(), 'fees', 0, 'My own version.');
    const reset = resetSection(edited, 'fees', defaults());
    expect(rulesOf(reset, 'fees')).toEqual(["Stayo's own wording."]);
  });

  it('leaves every other section as the owner has it', () => {
    const reset = resetSection(content(), 'fees', defaults());
    expect(rulesOf(reset, 'facilities')).toEqual(rulesOf(content(), 'facilities'));
  });

  it("leaves an owner's own section alone rather than emptying it", () => {
    // A section with no Stayo default is not a mistake to correct.
    expect(resetSection(content(), 'facilities', defaults())).toEqual(content());
  });
});

describe('variables', () => {
  it('finds every variable in use, deduplicated', () => {
    expect(variablesUsed(content())).toEqual(['{MONTHLY_RENT}']);
  });

  it('names variables Stayo cannot fill', () => {
    // A typo produces a token that looks right and resolves to nothing —
    // worth catching before publishing, not after a tenant signs.
    const typo = editLine(content(), 'fees', 2, 'Rent is ₹{MONTLY_RENT}.');
    expect(unknownVariables(typo)).toEqual(['{MONTLY_RENT}']);
    expect(unknownVariables(content())).toEqual([]);
  });

  it('fills known values and leaves unknown tokens visible', () => {
    expect(fillVariables('Rent ₹{MONTHLY_RENT} and ₹{NOPE}.', { '{MONTHLY_RENT}': '8,000' }))
      .toBe('Rent ₹8,000 and ₹{NOPE}.');
  });
});

describe('hasDraftChanges', () => {
  it('is false while the draft matches what is published', () => {
    expect(hasDraftChanges(content(), content())).toBe(false);
  });

  it('is true after any edit', () => {
    expect(hasDraftChanges(editLine(content(), 'fees', 0, 'Changed.'), content())).toBe(true);
  });

  it('is true when nothing is published yet', () => {
    expect(hasDraftChanges(content(), null)).toBe(true);
  });
});

describe('countEnabledLines', () => {
  it('counts what would actually be published', () => {
    expect(countEnabledLines(content())).toBe(4);
  });

  it('leaves an excluded section out of the count', () => {
    expect(countEnabledLines(toggleSection(content(), 'fees'))).toBe(1);
  });
});
