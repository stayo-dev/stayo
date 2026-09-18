/**
 * What changed between two published versions of a hostel's agreement.
 *
 * ## Why this is computed, never stored
 *
 * A summary column would be a second description of a document people sign,
 * able to drift from the text it describes — and a `schema.prisma` change is
 * the single most expensive part of shipping anything here (see the
 * deploy-before-migrate rule in the vault's Bugs log). The lineage already
 * holds every version's full `rules_content`, so the summary is derived on
 * read and cannot be wrong.
 *
 * ## Why this diffs by id, where the frontend's `agreementDiff.ts` diffs by title
 *
 * That one compares *composed documents*, which carry no ids — only numbered,
 * titled sections — so a title is the only stable handle it has. This one
 * compares raw `rules_content`, where every section has a durable id. Using it
 * means a renamed section reads as **reworded**, which is what happened, rather
 * than as one section removed and an unrelated one added.
 *
 * Vocabulary is deliberately the publish review's: added / reworded / removed,
 * counted in *sections*. An owner should meet the same words describing the
 * same change before they publish it and afterwards in the history.
 */

export type RuleCategoryLike = {
  id?: string | null;
  title?: string | null;
  rules?: unknown;
  highlights?: unknown;
  enabled?: boolean;
};

export type TermLike = { id?: string | null; title?: string | null; content?: unknown };

export type RulesContentLike = {
  categories?: unknown;
  terms_and_conditions?: unknown;
} | null | undefined;

export type VersionChange = {
  added: number;
  reworded: number;
  removed: number;
  unchanged: number;
  /** Meta text for a history row: "1 added · 2 reworded". */
  summary: string;
};

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asStrings = (value: unknown): string[] =>
  asArray<unknown>(value).map((line) => String(line ?? ""));

/**
 * Every section as the tenant would receive it, keyed by id.
 *
 * A section the owner has left out is **absent**, not empty: the composer
 * filters `enabled === false` before rendering, so leaving one out really does
 * remove it from the document, and the history should say so.
 */
function sectionsById(content: RulesContentLike): Map<string, string> {
  const map = new Map<string, string>();

  for (const term of asArray<TermLike>(content?.terms_and_conditions)) {
    const id = String(term?.id ?? "").trim();
    if (!id) continue;
    map.set(`term:${id}`, `${String(term?.title ?? "")}\n${String(term?.content ?? "")}`);
  }

  for (const category of asArray<RuleCategoryLike>(content?.categories)) {
    const id = String(category?.id ?? "").trim();
    if (!id) continue;
    if (category?.enabled === false) continue;
    // Mirrors the composer, which renders highlights ahead of rules.
    const body = [...asStrings(category?.highlights), ...asStrings(category?.rules)].join("\n");
    map.set(`category:${id}`, `${String(category?.title ?? "")}\n${body}`);
  }

  return map;
}

export function summariseVersionChange(
  previous: RulesContentLike,
  next: RulesContentLike,
): VersionChange {
  const to = sectionsById(next);

  // No predecessor is not "everything was added" — it is the first version,
  // and saying "9 added" of a document nobody had before is noise.
  if (previous === null || previous === undefined) {
    return { added: 0, reworded: 0, removed: 0, unchanged: to.size, summary: "First version" };
  }

  const from = sectionsById(previous);

  let added = 0;
  let reworded = 0;
  let unchanged = 0;
  let removed = 0;

  // `forEach` rather than `for…of`: this package targets an ES level where
  // iterating a Map needs `downlevelIteration`.
  to.forEach((text, key) => {
    if (!from.has(key)) added += 1;
    else if (from.get(key) !== text) reworded += 1;
    else unchanged += 1;
  });

  from.forEach((_text, key) => {
    if (!to.has(key)) removed += 1;
  });

  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (reworded > 0) parts.push(`${reworded} reworded`);
  if (removed > 0) parts.push(`${removed} removed`);

  return {
    added,
    reworded,
    removed,
    unchanged,
    summary: parts.length > 0 ? parts.join(" · ") : "No change to the document",
  };
}
