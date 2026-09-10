/**
 * Who a document — or a section within one — is addressed to. Phase 1 stores
 * this; the reader-side filter is Phase 2. Storing it now means the schedules
 * are already tagged when the filter arrives.
 */
export type LegalAudience = 'all' | 'owner' | 'resident';

/**
 * The block vocabulary real legal text needs. The previous renderer typed this
 * as `any`, which is why lists, tables and numbered clauses could not be
 * expressed and every document was a wall of paragraphs.
 */
export type LegalBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'subheading'; id: string; text: string; audience?: LegalAudience }
  | { type: 'clause'; id: string; number: string; text: string }
  | { type: 'notice'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'definitions'; items: { term: string; definition: string }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'contact_list'; items: { label: string; value: string }[] };

export interface LegalDocument {
  id: string;
  title: string;
  /** Canonical route. Tasks 9 and 12 assert this resolves. */
  route: string;
  /** Older URLs kept alive — aggregators and Meta may have registered them. */
  aliases: string[];
  version: string;
  /** ISO yyyy-mm-dd. */
  effectiveDate: string;
  /** The "In short" bullets. Never overrides the terms; always labelled. */
  summary: string[];
  audience: LegalAudience;
  /** True when a change is material enough to re-prompt for acceptance (Phase 4). */
  material: boolean;
  metaDescription: string;
  content: LegalBlock[];
}

export interface Anchor {
  id: string;
  text: string;
  level: 'section' | 'clause';
}
