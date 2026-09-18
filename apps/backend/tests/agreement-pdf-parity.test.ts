import { describe, expect, it } from "vitest";
import { buildAgreementDocument, pdfTermsList } from "@/src/services/agreements/agreement-document";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";

/**
 * The PDF and the reader must show the same document.
 *
 * "Same" means the same clauses, with the same text, in the same order. It does
 * *not* mean identical numbering: the PDF presents the hostel's own rules as a
 * separate "HOSTEL RULES & REGULATIONS" section incorporated by reference,
 * while the reader renders one continuous instrument. Unifying those two
 * presentations is Phase 3; keeping their content from drifting is Phase 1.
 */

const renderData: any = {
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  roomNo: "101",
  monthlyRent: 8000,
  advanceDeposit: 16000,
  maintenanceCharge: 500,
  joiningDate: "2026-09-01",
  paymentFrequency: "Monthly",
  hostelRules: {
    categories: [
      { id: "fees", title: "Fees", rules: ["Rent is {{MONTHLY_RENT}}."] },
      { id: "gone", title: "Withdrawn", enabled: false, rules: ["The owner removed this."] },
    ],
  },
  termsAndConditions: [{ title: "Notice Period", content: "Notice Period: Thirty days." }],
  tenantSignatureName: null,
  tenantSignatureUrl: null,
  guardianSignatureName: null,
  guardianSignatureUrl: null,
  guardianRelation: null,
  ownerSignatureUrl: null,
  ownerSignedAt: null,
  agreementStartDate: "2026-09-01",
};

const opts = { reference: "AGR-42", versionNumber: 1, status: "SIGNED", verificationUrl: null };
const compose = (over: any = {}) =>
  buildAgreementDocument(agreementDocumentInputFromRenderData({ ...renderData, ...over }, opts));
const sections = (over: any = {}) =>
  compose(over).blocks.filter((b: any) => b.kind === "section") as any[];

const PLATFORM_CLAUSE_COUNT = 5;

describe("PDF and reader show the same document", () => {
  it("orders the bands: the hostel's terms, then its rules, then the platform clauses", () => {
    expect(sections().map((s) => `${s.origin}:${s.band}`)).toEqual([
      "owner:terms",
      "owner:rules",
      ...Array(PLATFORM_CLAUSE_COUNT).fill("platform:terms"),
    ]);
  });

  it("gives the composed document continuous numbering with no gaps", () => {
    const numbers = sections().map((s) => s.number);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("interpolates the same values the PDF prints", () => {
    expect(sections().find((s) => s.band === "rules")!.clauses[0].text).toBe("Rent is 8000.");
  });

  it("excludes a section the owner switched off", () => {
    // The PDF used to iterate categories raw, so a clause the owner removed
    // still printed on the document their tenant signed.
    expect(sections().map((s) => s.title)).not.toContain("Withdrawn");
  });

  it("strips a clause title the stored body repeats, as the PDF always did", () => {
    expect(sections().find((s) => s.title === "Notice Period")!.clauses[0].text).toBe("Thirty days.");
  });

  it("keeps the platform clauses last even when the hostel has no terms of its own", () => {
    const s = sections({ termsAndConditions: [] });
    expect(s.filter((x) => x.origin === "platform")).toHaveLength(PLATFORM_CLAUSE_COUNT);
    expect(s[s.length - 1].origin).toBe("platform");
  });

  /**
   * The exact mapping `generatePdfBuffer` runs, imported rather than
   * reimplemented -- a test that copied the mapping would pass while the
   * renderer drifted.
   */
  const pdfTerms = (over: any = {}) => pdfTermsList(compose(over));

  it("renumbers the PDF's own terms list from 1 with no gaps", () => {
    const list = pdfTerms();
    expect(list.map((t) => t.number)).toEqual(list.map((_, i) => i + 1));
  });

  it("carries the hostel's own term first in the PDF's terms list", () => {
    expect(pdfTerms()[0]).toEqual({ number: 1, title: "Notice Period", body: "Thirty days." });
  });

  it("includes every platform clause in the PDF's terms list", () => {
    expect(pdfTerms()).toHaveLength(1 + PLATFORM_CLAUSE_COUNT);
    expect(pdfTerms().map((t) => t.title)).toContain("Governing Law and Jurisdiction");
  });
});
