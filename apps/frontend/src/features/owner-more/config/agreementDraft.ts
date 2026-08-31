import type { RulesCategory, RulesContent } from './agreements';

/**
 * Editing an agreement, line by line.
 *
 * ## Why the operations are pure
 *
 * This edits a document tenants sign. Every operation below rewrites part of
 * `rules_content`, and a mistake here is not a broken screen — it is a clause
 * silently missing from an agreement somebody already signed. The rules are
 * therefore separated from the editor that renders them, so each one can be
 * stated and checked on its own.
 *
 * ## Why lines, not a rich-text box
 *
 * An agreement is `categories[]`, each holding `rules[]` — an array of
 * strings. Every line an owner reads is one of those strings. A rich-text
 * editor would flatten that into markup and take three features with it:
 * `countClauses` could no longer count, Highlights could no longer pick out
 * key terms, and "reset this section to Stayo's wording" would have nothing to
 * reset *to*. Constrained line editing keeps the structure every downstream
 * feature depends on.
 *
 * ## Immutability
 *
 * Every function returns new objects rather than mutating. React state aside,
 * the draft is compared against the published version to decide whether there
 * is anything to save, and an in-place mutation would make that comparison
 * always say "no".
 */

export interface DraftLine {
  categoryId: string;
  index: number;
  text: string;
}

function mapCategory(
  content: RulesContent,
  categoryId: string,
  fn: (category: RulesCategory) => RulesCategory,
): RulesContent {
  return {
    ...content,
    categories: (content.categories ?? []).map((c) => (c.id === categoryId ? fn(c) : c)),
  };
}

function withRules(category: RulesCategory, rules: string[]): RulesCategory {
  return { ...category, rules };
}

/** Replace one line. Blank text is rejected — use `removeLine` to delete. */
export function editLine(
  content: RulesContent,
  categoryId: string,
  index: number,
  text: string,
): RulesContent {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return content;
  return mapCategory(content, categoryId, (c) =>
    withRules(c, (c.rules ?? []).map((rule, i) => (i === index ? trimmed : rule))),
  );
}

/** Insert a new line after `index`. Pass -1 to add at the top. */
export function addLine(content: RulesContent, categoryId: string, index: number, text = ''): RulesContent {
  return mapCategory(content, categoryId, (c) => {
    const rules = [...(c.rules ?? [])];
    rules.splice(Math.max(0, index + 1), 0, text);
    return withRules(c, rules);
  });
}

export function removeLine(content: RulesContent, categoryId: string, index: number): RulesContent {
  return mapCategory(content, categoryId, (c) =>
    withRules(c, (c.rules ?? []).filter((_, i) => i !== index)),
  );
}

/**
 * Move a line within its section.
 *
 * Order carries meaning in a legal document — "the following applies to clause
 * 3" stops making sense if 3 moves — so this never reorders across sections,
 * where the numbering an owner sees would change under them.
 */
export function moveLine(
  content: RulesContent,
  categoryId: string,
  index: number,
  direction: -1 | 1,
): RulesContent {
  return mapCategory(content, categoryId, (c) => {
    const rules = [...(c.rules ?? [])];
    const target = index + direction;
    if (index < 0 || index >= rules.length || target < 0 || target >= rules.length) return c;
    [rules[index], rules[target]] = [rules[target], rules[index]];
    return withRules(c, rules);
  });
}

export function renameSection(content: RulesContent, categoryId: string, title: string): RulesContent {
  const trimmed = String(title ?? '').trim();
  if (!trimmed) return content;
  return mapCategory(content, categoryId, (c) => ({ ...c, title: trimmed }));
}

/**
 * Include or exclude a whole section.
 *
 * Excluding keeps the text: an owner who drops "Pets" for this year and wants
 * it back next year should not have to retype it. `enabled` is absent on
 * templates written before the flag existed, and absent means included.
 */
export function toggleSection(content: RulesContent, categoryId: string): RulesContent {
  return mapCategory(content, categoryId, (c) => ({ ...c, enabled: c.enabled === false }));
}

export function isSectionEnabled(category: RulesCategory): boolean {
  return category.enabled !== false;
}

/** Sections marked important are the ones surfaced to tenants as highlights. */
export function toggleImportant(content: RulesContent, categoryId: string): RulesContent {
  return mapCategory(content, categoryId, (c) => ({
    ...c,
    severity: c.severity === 'important' ? 'standard' : 'important',
  }));
}

/**
 * Restore one section to Stayo's own wording, leaving every other section as
 * the owner has it. A section missing from the defaults is left untouched
 * rather than emptied — an owner's own section is not a mistake to correct.
 */
export function resetSection(
  content: RulesContent,
  categoryId: string,
  defaults: RulesContent | null | undefined,
): RulesContent {
  const original = (defaults?.categories ?? []).find((c) => c.id === categoryId);
  if (!original) return content;
  return mapCategory(content, categoryId, () => ({ ...original }));
}

/**
 * The variables a line may carry, written as `{NAME}` and filled per tenant.
 *
 * Owners insert these from a menu rather than typing them: one mistyped
 * identifier ships a literal `{MONTLY_RENT}` into a signed agreement, and
 * nothing downstream would catch it.
 */
export const AGREEMENT_VARIABLES: { token: string; label: string }[] = [
  { token: '{TENANT_NAME}', label: "Tenant's name" },
  { token: '{MONTHLY_RENT}', label: 'Monthly rent' },
  { token: '{SECURITY_DEPOSIT_AMOUNT}', label: 'Security deposit' },
  { token: '{MAINTENANCE_CHARGE_AMOUNT}', label: 'Maintenance charge' },
  { token: '{ROOM_NUMBER}', label: 'Room number' },
  { token: '{JOINING_DATE}', label: 'Joining date' },
  { token: '{HOSTEL_NAME}', label: 'Hostel name' },
  { token: '{OWNER_NAME}', label: 'Owner name' },
];

const VARIABLE_PATTERN = /\{[A-Z_]+\}/g;

/** Every variable used anywhere in the document, deduplicated. */
export function variablesUsed(content: RulesContent | null | undefined): string[] {
  const found = new Set<string>();
  for (const category of content?.categories ?? []) {
    for (const rule of category.rules ?? []) {
      for (const match of String(rule).match(VARIABLE_PATTERN) ?? []) found.add(match);
    }
  }
  return [...found];
}

/**
 * Variables in the text that Stayo cannot fill.
 *
 * A typo produces a token that looks right and resolves to nothing, so it is
 * worth naming before an owner publishes rather than after a tenant signs.
 */
export function unknownVariables(content: RulesContent | null | undefined): string[] {
  const known = new Set(AGREEMENT_VARIABLES.map((v) => v.token));
  return variablesUsed(content).filter((token) => !known.has(token));
}

/** Substitute real values, for the tenant-eye preview. */
export function fillVariables(text: string, values: Record<string, string>): string {
  return String(text ?? '').replace(VARIABLE_PATTERN, (token) => values[token] ?? token);
}

/**
 * Add a section of the owner's own.
 *
 * The editor could rewrite Stayo's sections and not write one, which made it a
 * tool for correcting our document rather than authoring theirs. A hostel with
 * a rule we never thought of — a curfew, a guest policy, a kitchen rota — had
 * nowhere to put it.
 *
 * The id is prefixed so an owner's own section is distinguishable from one of
 * ours: `resetSection` must leave it alone, having no default to restore it
 * to, and a future default with a colliding id must not overwrite it.
 */
export function addSection(content: RulesContent, title = 'New section'): RulesContent {
  const id = `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    ...content,
    categories: [
      ...(content.categories ?? []),
      { id, title: String(title ?? '').trim() || 'New section', severity: 'standard', rules: [''] },
    ],
  };
}

/**
 * Delete a section outright.
 *
 * Distinct from `toggleSection`, which keeps the text for later. This is for a
 * section an owner never wants — and it is the only destructive operation
 * here, so the screen confirms before calling it.
 */
export function removeSection(content: RulesContent, categoryId: string): RulesContent {
  return {
    ...content,
    categories: (content.categories ?? []).filter((c) => c.id !== categoryId),
  };
}

/** Reorder sections. Section order is the document's order of argument. */
export function moveSection(content: RulesContent, categoryId: string, direction: -1 | 1): RulesContent {
  const categories = [...(content.categories ?? [])];
  const index = categories.findIndex((c) => c.id === categoryId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= categories.length) return content;
  [categories[index], categories[target]] = [categories[target], categories[index]];
  return { ...content, categories };
}

/**
 * Turn an owner's pasted agreement into sections and lines.
 *
 * Most owners already have an agreement — in Word, or printed and retyped
 * every year. Asking them to re-enter it a line at a time is how a good
 * editor still goes unused, so this accepts the whole thing at once.
 *
 * A line is treated as a heading when it is numbered ("1." / "1)") or is short
 * and unpunctuated — the two shapes headings actually take in these documents.
 * Everything else becomes a rule under the heading above it. Text before any
 * heading gets a section of its own rather than being dropped.
 *
 * Deliberately forgiving rather than clever: an owner can fix a
 * mis-detected heading in two taps, but silently losing a clause is not
 * recoverable.
 */
export function parsePastedAgreement(text: string): RulesContent {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const categories: RulesCategory[] = [];
  let current: RulesCategory | null = null;
  let counter = 0;

  const isHeading = (line: string): boolean => {
    if (/^\d+[.)]\s+/.test(line)) return true;
    return line.length <= 60 && !/[.;:]$/.test(line) && line.split(/\s+/).length <= 8;
  };

  for (const line of lines) {
    if (isHeading(line)) {
      current = {
        id: `own-${Date.now().toString(36)}-${counter++}`,
        title: line.replace(/^\d+[.)]\s*/, '').trim() || 'Section',
        severity: 'standard',
        rules: [],
      };
      categories.push(current);
      continue;
    }
    if (!current) {
      // Text before any heading. Keeping it in its own section beats dropping
      // it: a preamble is still part of the agreement.
      current = { id: `own-${Date.now().toString(36)}-${counter++}`, title: 'Introduction', severity: 'standard', rules: [] };
      categories.push(current);
    }
    current.rules = [...(current.rules ?? []), line];
  }

  return { categories: categories.filter((c) => (c.rules ?? []).length > 0) };
}

/** Nothing to save when the draft matches what is already published. */
export function hasDraftChanges(
  draft: RulesContent | null | undefined,
  published: RulesContent | null | undefined,
): boolean {
  if (!draft) return false;
  return JSON.stringify(draft) !== JSON.stringify(published ?? null);
}

/** How many lines an owner would actually be publishing. */
export function countEnabledLines(content: RulesContent | null | undefined): number {
  return (content?.categories ?? [])
    .filter(isSectionEnabled)
    .reduce((total, c) => total + (c.rules ?? []).length, 0);
}
