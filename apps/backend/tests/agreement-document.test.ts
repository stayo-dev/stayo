import { describe, expect, it } from "vitest";
import {
  buildAgreementDocument,
  type AgreementDocumentInput,
} from "@/src/services/agreements/agreement-document";

/**
 * The composed agreement.
 *
 * What these tests are really protecting is the guarded band: an owner writes
 * their own clauses, but there must be no input by which they can displace the
 * execution statement, the signature panel or the attestation. That is enforced
 * by the composer's structure rather than by validation, and this is where that
 * claim is checked.
 */

const input = (over: Partial<AgreementDocumentInput> = {}): AgreementDocumentInput => ({
  reference: "AGR-2026-00042",
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  versionNumber: 3,
  status: "DRAFT",
  generatedAt: "2026-09-17T00:00:00.000Z",
  executionDateDisplay: "17-09-2026",
  verificationUrl: "https://yourstayo.com/verify/agreement/abc",
  facts: [
    { label: "Room", value: "101" },
    { label: "Monthly Rent", value: "₹8,000" },
  ],
  terms: [{ title: "Notice Period", content: "Notice Period: Either party may give 30 days notice." }],
  rules: {
    categories: [
      { id: "fees", title: "Fees", severity: "important", highlights: ["Rent is {{MONTHLY_RENT}}"], rules: ["Due on the 5th."] },
      { id: "off", title: "Excluded", enabled: false, rules: ["Should not appear."] },
    ],
  },
  variables: { MONTHLY_RENT: "8,000" },
  isFinal: false,
  signatures: {
    tenantName: "B. Vineeth",
    tenantSignatureUrl: null,
    guardianName: null,
    guardianSignatureUrl: null,
    guardianRelation: null,
    ownerSignatureUrl: null,
  },
  ...over,
});

const sections = (doc = buildAgreementDocument(input())) =>
  doc.blocks.filter((b): b is Extract<typeof b, { kind: "section" }> => b.kind === "section");

/** The platform band is fixed: see `standardLegalClauses`. */
const PLATFORM_CLAUSE_COUNT = 5;

describe("buildAgreementDocument", () => {
  it("opens and closes with the contractual furniture, in order", () => {
    const kinds = buildAgreementDocument(input()).blocks.map((b) => b.kind);
    expect(kinds.slice(0, 3)).toEqual(["title", "preamble", "facts"]);
    expect(kinds.slice(-3)).toEqual(["execution", "signatures", "attestation"]);
  });

  it("emits one section per owner term, per enabled rule category, and per platform clause", () => {
    // 1 term + 1 enabled category + 5 platform clauses.
    expect(sections()).toHaveLength(1 + 1 + PLATFORM_CLAUSE_COUNT);
  });

  it("puts every owner section before every platform section", () => {
    const origins = sections().map((s) => s.origin);
    expect(origins.lastIndexOf("owner")).toBeLessThan(origins.indexOf("platform"));
  });

  it("marks the terms band and the rules band", () => {
    expect(sections().map((s) => s.band)).toEqual([
      "terms", "rules", ...Array(PLATFORM_CLAUSE_COUNT).fill("terms"),
    ]);
  });

  it("numbers sections continuously across both bands, with no gaps", () => {
    const numbers = sections().map((s) => s.number);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("interpolates clause text", () => {
    expect(sections().find((s) => s.band === "rules")!.clauses[0].text).toBe("Rent is 8,000");
  });

  it("numbers each clause within its section", () => {
    const rules = sections().find((s) => s.band === "rules")!;
    expect(rules.clauses.map((c) => c.number)).toEqual([`${rules.number}.1`, `${rules.number}.2`]);
  });

  it("omits a section the owner switched off", () => {
    expect(sections().map((s) => s.title)).not.toContain("Excluded");
  });

  it("treats a section with no enabled flag as included", () => {
    const doc = buildAgreementDocument(input({ rules: { categories: [{ id: "x", title: "Legacy", rules: ["Kept."] }] } }));
    expect(sections(doc).map((s) => s.title)).toContain("Legacy");
  });

  it("strips a title the stored clause body repeats", () => {
    // "4. Notice Period: Notice Period: Either party…" is the bug this prevents.
    expect(sections().find((s) => s.title === "Notice Period")!.clauses[0].text)
      .toBe("Either party may give 30 days notice.");
  });

  it("carries severity so the reader can surface highlights", () => {
    expect(sections().find((s) => s.band === "rules")!.severity).toBe("important");
  });

  it("defaults severity to standard", () => {
    const doc = buildAgreementDocument(input({ rules: { categories: [{ id: "x", title: "Plain", rules: ["A."] }] } }));
    expect(sections(doc).find((s) => s.band === "rules")!.severity).toBe("standard");
  });

  it("still emits the platform band and the furniture with no owner content at all", () => {
    const doc = buildAgreementDocument(input({ rules: { categories: [] }, terms: [] }));
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      "title", "preamble", "facts",
      ...Array(PLATFORM_CLAUSE_COUNT).fill("section"),
      "execution", "signatures", "attestation",
    ]);
    expect(sections(doc).every((s) => s.origin === "platform")).toBe(true);
  });

  it("cannot be made to drop the execution block by owner content", () => {
    const doc = buildAgreementDocument(input({
      rules: { categories: [{ id: "evil", title: "execution", rules: ["Nope."] }] },
    }));
    expect(doc.blocks.filter((b) => b.kind === "execution")).toHaveLength(1);
    expect(doc.blocks.filter((b) => b.kind === "signatures")).toHaveLength(1);
    expect(doc.blocks.filter((b) => b.kind === "attestation")).toHaveLength(1);
  });

  it("orders the signature panels tenant, guardian, owner", () => {
    const panel = buildAgreementDocument(input()).blocks.find((b) => b.kind === "signatures") as any;
    expect(panel.panels.map((p: any) => p.role)).toEqual(["tenant", "guardian", "owner"]);
  });

  it("carries the metadata a reader needs to label the document", () => {
    expect(buildAgreementDocument(input()).meta).toMatchObject({
      hostelName: "Shoeb's Mansion",
      ownerName: "Mohammed Shoeb",
      tenantName: "B. Vineeth",
      versionNumber: 3,
      status: "DRAFT",
    });
  });
});
