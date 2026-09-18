import type { AgreementDocument, SectionBlock } from '@features/agreements/document/agreementDocument';

/**
 * What publishing would change.
 *
 * Publishing used to be one tap into the dark: no diff, no count of who it
 * affects, and "version history" that was just the template list. An owner
 * could reword a notice period and have no way to see what they had altered.
 */

export type DocumentDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
};

/**
 * Keyed by section **title**, not number.
 *
 * Numbers shift when a section is inserted above, which would report an
 * untouched document as entirely rewritten. Titles are what an owner recognises
 * and what they actually changed.
 */
function sectionsByTitle(doc: AgreementDocument | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of doc?.blocks ?? []) {
    if (block.kind !== 'section') continue;
    const section = block as SectionBlock;
    map.set(section.title, section.clauses.map((c) => c.text).join('\n'));
  }
  return map;
}

export function diffAgreementDocument(
  before: AgreementDocument | null | undefined,
  after: AgreementDocument | null | undefined,
): DocumentDiff {
  const from = sectionsByTitle(before);
  const to = sectionsByTitle(after);

  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;

  for (const [title, text] of to) {
    if (!from.has(title)) added.push(title);
    else if (from.get(title) !== text) changed.push(title);
    else unchanged += 1;
  }

  const removed = [...from.keys()].filter((title) => !to.has(title));

  return { added, removed, changed, unchanged };
}

/** True when publishing would alter the document a tenant signs. */
export function hasChanges(diff: DocumentDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
