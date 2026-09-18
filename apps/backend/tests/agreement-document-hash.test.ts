import { describe, expect, it } from "vitest";
import {
  buildAgreementDocument,
  hashAgreementDocument,
  type AgreementDocumentInput,
} from "@/src/services/agreements/agreement-document";

/**
 * The fidelity guarantee.
 *
 * The hash is what lets us assert that the document a tenant read and the PDF
 * generated afterwards are the same document. It must therefore cover exactly
 * the agreed content and nothing else: not when it was rendered, and not the
 * signature images applied after the content was agreed.
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
  facts: [{ label: "Room", value: "101" }],
  terms: [{ title: "Notice Period", content: "Thirty days notice." }],
  rules: {
    categories: [
      { id: "fees", title: "Fees", rules: ["Due on the 5th."] },
      { id: "wifi", title: "Facilities", rules: ["Wi-Fi is provided."] },
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

describe("hashAgreementDocument", () => {
  it("is a 64-character lowercase hex digest", () => {
    expect(hashAgreementDocument(buildAgreementDocument(input()).blocks)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls with identical content", () => {
    expect(hashAgreementDocument(buildAgreementDocument(input()).blocks))
      .toBe(hashAgreementDocument(buildAgreementDocument(input()).blocks));
  });

  it("ignores generatedAt, which is not part of the agreed content", () => {
    // The same agreement rendered twice must hash the same, or the guarantee
    // is worthless -- it would fail on every second render.
    expect(buildAgreementDocument(input({ generatedAt: "2026-01-01T00:00:00.000Z" })).contentHash)
      .toBe(buildAgreementDocument(input({ generatedAt: "2026-12-31T00:00:00.000Z" })).contentHash);
  });

  it("ignores signature images, which are applied after the content is agreed", () => {
    const signed = input();
    signed.signatures = { ...signed.signatures, tenantSignatureUrl: "https://img/sig.png" };
    expect(buildAgreementDocument(signed).contentHash).toBe(buildAgreementDocument(input()).contentHash);
  });

  it("changes when a clause is reworded", () => {
    expect(buildAgreementDocument(input({ terms: [{ title: "Notice Period", content: "Sixty days notice." }] })).contentHash)
      .not.toBe(buildAgreementDocument(input()).contentHash);
  });

  it("changes when sections are reordered", () => {
    const reversed = input({
      rules: {
        categories: [
          { id: "wifi", title: "Facilities", rules: ["Wi-Fi is provided."] },
          { id: "fees", title: "Fees", rules: ["Due on the 5th."] },
        ],
      },
    });
    expect(buildAgreementDocument(reversed).contentHash).not.toBe(buildAgreementDocument(input()).contentHash);
  });

  it("changes when a fact changes", () => {
    expect(buildAgreementDocument(input({ facts: [{ label: "Room", value: "202" }] })).contentHash)
      .not.toBe(buildAgreementDocument(input()).contentHash);
  });

  it("changes when a section is switched off", () => {
    const off = input();
    off.rules!.categories![1].enabled = false;
    expect(buildAgreementDocument(off).contentHash).not.toBe(buildAgreementDocument(input()).contentHash);
  });

  it("is populated on the built document", () => {
    const doc = buildAgreementDocument(input());
    expect(doc.contentHash).toBe(hashAgreementDocument(doc.blocks));
  });
});
