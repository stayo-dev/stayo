import { describe, expect, it } from "vitest";
import { CANONICAL_TERMS, normalizeAgreementTerms } from "@/src/services/agreements/agreement-terms";
import { DEFAULT_TERMS_AND_CONDITIONS } from "@/src/utils/default-rules";

/**
 * The five commercial terms.
 *
 * Owners write the body; the headings are fixed. That is a *server* rule, not a
 * UI convention — the save route previously validated only `id` and `content`,
 * so a client could rename a term, invent one, or drop the notice period
 * entirely and have it persist.
 */

const ids = () => CANONICAL_TERMS.map((t) => t.id);
const defaultContent = (id: string) =>
  (DEFAULT_TERMS_AND_CONDITIONS as any[]).find((t) => t.id === id)!.content;

describe("CANONICAL_TERMS", () => {
  it("is the five terms, in the order they appear in an agreement", () => {
    expect(ids()).toEqual([
      "residential_use", "rent_payment", "security_deposit", "notice_period", "hostel_rules_compliance",
    ]);
  });
});

describe("normalizeAgreementTerms", () => {
  it("returns the canonical five when given nothing", () => {
    expect(normalizeAgreementTerms(undefined).map((t) => t.id)).toEqual(ids());
    expect(normalizeAgreementTerms(null).map((t) => t.id)).toEqual(ids());
    expect(normalizeAgreementTerms([]).map((t) => t.id)).toEqual(ids());
  });

  it("keeps the owner's wording", () => {
    const out = normalizeAgreementTerms([{ id: "notice_period", content: "Sixty days written notice." }]);
    expect(out.find((t) => t.id === "notice_period")!.content).toBe("Sixty days written notice.");
  });

  it("ignores a title the client sent, and uses the canonical one", () => {
    const out = normalizeAgreementTerms([{ id: "notice_period", title: "Whatever I Like", content: "Text." }]);
    const canonical = CANONICAL_TERMS.find((t) => t.id === "notice_period")!.title;
    expect(out.find((t) => t.id === "notice_period")!.title).toBe(canonical);
  });

  it("drops a term the owner invented", () => {
    const out = normalizeAgreementTerms([{ id: "my_own_clause", title: "Mine", content: "Text." }]);
    expect(out.map((t) => t.id)).toEqual(ids());
  });

  it("restores a term the owner omitted, with its default wording", () => {
    // An agreement must never ship without a notice period because a client
    // forgot to send one.
    const out = normalizeAgreementTerms([{ id: "rent_payment", content: "Due on the 1st." }]);
    expect(out.find((t) => t.id === "notice_period")!.content).toBe(defaultContent("notice_period"));
    expect(out.find((t) => t.id === "rent_payment")!.content).toBe("Due on the 1st.");
  });

  it("always returns them in canonical order, whatever order they arrived in", () => {
    const shuffled = [...CANONICAL_TERMS].reverse().map((t) => ({ id: t.id, content: t.content }));
    expect(normalizeAgreementTerms(shuffled).map((t) => t.id)).toEqual(ids());
  });

  it("falls back to the default wording when the owner blanks a term", () => {
    const out = normalizeAgreementTerms([{ id: "notice_period", content: "   " }]);
    expect(out.find((t) => t.id === "notice_period")!.content).toBe(defaultContent("notice_period"));
  });

  it("tolerates junk without throwing", () => {
    expect(normalizeAgreementTerms("nonsense" as any).map((t) => t.id)).toEqual(ids());
    expect(normalizeAgreementTerms([null, 42, { id: 7 }] as any).map((t) => t.id)).toEqual(ids());
  });

  it("always returns exactly five terms, each with a title and content", () => {
    const out = normalizeAgreementTerms([{ id: "notice_period", content: "x" }]);
    expect(out).toHaveLength(5);
    expect(out.every((t) => Boolean(t.id && t.title && t.content))).toBe(true);
  });
});
