/**
 * The five commercial terms every Stayo agreement carries.
 *
 * PURE MODULE — no Prisma, no I/O.
 *
 * Owners write the body; the headings are fixed. Before this, the whole band
 * was frozen at Stayo's defaults, so notice period, rent payment and security
 * deposit read identically for every hostel on the platform — which is wrong
 * for terms that are genuinely per-hostel commercial decisions.
 *
 * Fixing the headings keeps two things true: no agreement can ship missing a
 * notice period, and any two Stayo agreements stay comparable clause for
 * clause. Neither survives if the band becomes a free list.
 *
 * This is enforced here rather than in the editor, because the save route
 * previously validated only `id` and `content` — a client could rename a term,
 * invent one, or omit the notice period and have it persist. See ADR-220.
 */
import { DEFAULT_TERMS_AND_CONDITIONS } from "../../utils/default-rules";

export type AgreementTerm = { id: string; title: string; content: string };

export const CANONICAL_TERMS: AgreementTerm[] = (DEFAULT_TERMS_AND_CONDITIONS as AgreementTerm[]).map(
  (term) => ({ id: term.id, title: term.title, content: term.content }),
);

/**
 * Normalises rather than rejects.
 *
 * A malformed payload is corrected into a valid agreement instead of failing
 * the owner's save — the alternative is an owner losing an afternoon's editing
 * to a validation error about a term they never touched.
 */
export function normalizeAgreementTerms(submitted: unknown): AgreementTerm[] {
  const ownerContent = new Map<string, string>();

  if (Array.isArray(submitted)) {
    for (const raw of submitted) {
      if (!raw || typeof raw !== "object") continue;
      const id = typeof (raw as any).id === "string" ? (raw as any).id.trim() : "";
      const content = typeof (raw as any).content === "string" ? (raw as any).content.trim() : "";
      // A blank body is not an edit — it falls through to Stayo's wording
      // rather than shipping an agreement with a hole in it.
      if (id && content) ownerContent.set(id, content);
    }
  }

  // Canonical order, canonical titles, owner content where there is any. A
  // title arriving from the client is ignored outright.
  return CANONICAL_TERMS.map((term) => ({
    id: term.id,
    title: term.title,
    content: ownerContent.get(term.id) || term.content,
  }));
}
