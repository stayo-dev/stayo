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
  addSection,
  removeSection,
  moveSection,
  parsePastedAgreement,
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

describe('authoring your own sections', () => {
  it('adds a section with one empty line ready to write in', () => {
    // The editor could rewrite Stayo's sections and not write one — a tool for
    // correcting our document rather than authoring theirs.
    const next = addSection(content(), 'Curfew');
    expect(next.categories).toHaveLength(3);
    expect(next.categories![2].title).toBe('Curfew');
    expect(next.categories![2].rules).toEqual(['']);
  });

  it("marks an owner's own section so reset leaves it alone", () => {
    // It has no Stayo default to restore to, and a future default with a
    // colliding id must not overwrite it.
    const own = addSection(content(), 'Curfew').categories![2];
    expect(own.id.startsWith('own-')).toBe(true);
    const reset = resetSection(addSection(content(), 'Curfew'), own.id, content());
    expect(reset.categories).toHaveLength(3);
  });

  it('falls back to a usable title rather than an empty one', () => {
    expect(addSection(content(), '   ').categories![2].title).toBe('New section');
  });

  it('deletes a section outright, unlike leaving it out', () => {
    const next = removeSection(content(), 'fees');
    expect(next.categories).toHaveLength(1);
    expect(next.categories![0].id).toBe('facilities');
  });

  it('reorders sections, and stops at the ends', () => {
    expect(moveSection(content(), 'facilities', -1).categories![0].id).toBe('facilities');
    expect(moveSection(content(), 'fees', -1)).toEqual(content());
    expect(moveSection(content(), 'facilities', 1)).toEqual(content());
  });
});

describe('parsePastedAgreement', () => {
  const pasted = `1. Fee Structure
Hostel fees once paid are non-refundable.
Rent is due on the 5th of each month.

2. Facilities
Wi-Fi is provided free of cost.`;

  it('turns a pasted document into sections and lines', () => {
    // Most owners already have an agreement. Asking them to retype it a line
    // at a time is how a good editor still goes unused.
    const parsed = parsePastedAgreement(pasted);
    expect(parsed.categories).toHaveLength(2);
    expect(parsed.categories![0].title).toBe('Fee Structure');
    expect(parsed.categories![0].rules).toHaveLength(2);
    expect(parsed.categories![1].title).toBe('Facilities');
  });

  it('strips the numbering from a heading, since the document renumbers itself', () => {
    expect(parsePastedAgreement('1) Rules\nNo smoking.').categories![0].title).toBe('Rules');
  });

  it('keeps text that arrives before any heading', () => {
    // A preamble is still part of the agreement. Dropping it is not
    // recoverable; putting it in its own section is fixable in two taps.
    const parsed = parsePastedAgreement('This agreement is made between the parties named below.\n1. Fees\nDue monthly.');
    expect(parsed.categories![0].title).toBe('Introduction');
    expect(parsed.categories![0].rules![0]).toContain('made between');
  });

  it('treats a short unpunctuated line as a heading', () => {
    const parsed = parsePastedAgreement('House Rules\nNo loud music after 10pm.');
    expect(parsed.categories![0].title).toBe('House Rules');
    expect(parsed.categories![0].rules).toEqual(['No loud music after 10pm.']);
  });

  it('does not mistake a long sentence for a heading', () => {
    const long = 'Students are required to vacate the premises during semester holidays and festival vacations';
    expect(parsePastedAgreement(`Rules\n${long}`).categories![0].rules).toEqual([long]);
  });

  it('drops nothing but empty lines', () => {
    const parsed = parsePastedAgreement(pasted);
    const total = parsed.categories!.reduce((n, c) => n + (c.rules ?? []).length, 0);
    expect(total).toBe(3);
  });

  it('survives empty input', () => {
    expect(parsePastedAgreement('').categories).toEqual([]);
    expect(parsePastedAgreement('   \n  ').categories).toEqual([]);
  });
});
