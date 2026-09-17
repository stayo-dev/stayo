/**
 * The agreement, as an ordered list of blocks.
 *
 * PURE MODULE — no Prisma, no pdf-lib, no I/O. Tested directly.
 *
 * This exists because the document an owner drafted, the document a tenant was
 * shown, and the PDF that was generated were three different artifacts composed
 * by three different pieces of code. The tenant's copy in particular was
 * hardcoded and contained none of the owner's clauses. They are now one model
 * with two renderers: HTML in the tenant app, pdf-lib on the server.
 *
 * **Block order is decided here, not by data.** Owner content can only ever
 * occupy the `origin: 'owner'` band; there is no input by which an owner can
 * displace the execution statement, the signature panel or the attestation.
 * That is what makes the legal frame *guarded* rather than merely validated —
 * it is a property of the structure, not of a check someone could forget.
 */
import {
  clauseBody,
  executionStatement,
  numberClauses,
  placeFromAddress,
  platformAttestation,
  preamble,
  standardLegalClauses,
} from "./agreement-boilerplate";
import { interpolateText } from "../../utils/default-rules";

export type SignaturePanel = {
  role: "tenant" | "guardian" | "owner";
  name: string | null;
  signatureUrl: string | null;
  relation: string | null;
};

export type RuleCategoryInput = {
  id: string;
  title: string;
  severity?: string;
  highlights?: string[];
  rules?: string[];
  enabled?: boolean;
};

export type DocBlock =
  | { kind: "title"; text: string; subtitle?: string }
  | { kind: "preamble"; text: string }
  | { kind: "facts"; rows: Array<{ label: string; value: string }> }
  | {
      kind: "section";
      number: number;
      title: string;
      clauses: Array<{ number: string; text: string }>;
      origin: "owner" | "platform";
      /**
       * Which of the document's two content bands this section belongs to.
       *
       * The PDF has always rendered `terms_and_conditions` as numbered legal
       * clauses *and* `rules_content.categories` as a separate section
       * incorporated by reference. The owner's editor only ever touched the
       * second. Keeping the distinction lets the renderers present them the way
       * they always have, while the composer numbers them as one instrument.
       */
      band: "terms" | "rules";
      severity?: "important" | "standard";
    }
  | { kind: "execution"; text: string }
  | { kind: "signatures"; panels: SignaturePanel[] }
  | { kind: "attestation"; text: string; verificationUrl: string | null };

export type AgreementDocumentInput = {
  reference: string;
  hostelName: string;
  hostelAddress: string;
  ownerName: string;
  tenantName: string;
  versionNumber: number;
  status: string;
  generatedAt: string;
  executionDateDisplay: string | null;
  verificationUrl: string | null;
  facts: Array<{ label: string; value: string }>;
  terms: Array<{ title: string; content: string }>;
  rules: { categories?: RuleCategoryInput[] } | null;
  variables: Record<string, any>;
  /** True once the document is being issued — unknown tokens blank to `____`. */
  isFinal: boolean;
  signatures: {
    tenantName: string | null;
    tenantSignatureUrl: string | null;
    guardianName: string | null;
    guardianSignatureUrl: string | null;
    guardianRelation: string | null;
    ownerSignatureUrl: string | null;
  };
};

export type AgreementDocument = {
  reference: string;
  contentHash: string;
  blocks: DocBlock[];
  meta: {
    hostelName: string;
    ownerName: string;
    tenantName: string;
    versionNumber: number;
    generatedAt: string;
    status: string;
  };
};

/** Absent means included: sections predate the flag. */
function isEnabled(category: RuleCategoryInput): boolean {
  return category.enabled !== false;
}

export function buildAgreementDocument(input: AgreementDocumentInput): AgreementDocument {
  const placeOfExecution = placeFromAddress(input.hostelAddress);
  const legalContext = {
    hostelName: input.hostelName,
    hostelAddress: input.hostelAddress,
    ownerName: input.ownerName,
    tenantName: input.tenantName,
    agreementReference: input.reference,
    executionDateDisplay: input.executionDateDisplay,
    placeOfExecution,
    terms: [],
    verificationUrl: input.verificationUrl,
  };

  const fill = (text: string) => interpolateText(text, input.variables, input.isFinal);

  const blocks: DocBlock[] = [
    { kind: "title", text: "HOSTEL ACCOMMODATION AGREEMENT", subtitle: input.hostelName },
    { kind: "preamble", text: preamble(legalContext) },
    { kind: "facts", rows: input.facts },
  ];

  // ── The owner band ──────────────────────────────────────────────────────
  // The hostel's own terms lead, then the hostel's own rules. Numbering is one
  // running sequence so the document reads as a single instrument rather than
  // two stapled together.
  let number = 0;

  for (const term of input.terms) {
    number += 1;
    blocks.push({
      kind: "section",
      number,
      title: String(term.title || "").trim(),
      // `clauseBody` strips a title the stored content repeats — the source of
      // "4. Notice Period: Notice Period: Either party…".
      clauses: [{ number: `${number}`, text: fill(clauseBody(term.title, term.content)) }],
      origin: "owner",
      band: "terms",
    });
  }

  for (const category of (input.rules?.categories ?? []).filter(isEnabled)) {
    number += 1;
    const lines = [...(category.highlights ?? []), ...(category.rules ?? [])];
    blocks.push({
      kind: "section",
      number,
      title: String(category.title || "").trim(),
      clauses: lines.map((line, index) => ({ number: `${number}.${index + 1}`, text: fill(line) })),
      origin: "owner",
      band: "rules",
      severity: category.severity === "important" ? "important" : "standard",
    });
  }

  // ── The guarded platform band ───────────────────────────────────────────
  // Appended after the owner's wording, always, and unreachable from input.
  for (const clause of numberClauses(standardLegalClauses(legalContext))) {
    number += 1;
    blocks.push({
      kind: "section",
      number,
      title: clause.title,
      clauses: [{ number: `${number}`, text: clause.body }],
      origin: "platform",
      band: "terms",
    });
  }

  blocks.push(
    { kind: "execution", text: executionStatement(legalContext) },
    {
      kind: "signatures",
      panels: [
        { role: "tenant", name: input.signatures.tenantName, signatureUrl: input.signatures.tenantSignatureUrl, relation: null },
        { role: "guardian", name: input.signatures.guardianName, signatureUrl: input.signatures.guardianSignatureUrl, relation: input.signatures.guardianRelation },
        { role: "owner", name: input.ownerName, signatureUrl: input.signatures.ownerSignatureUrl, relation: null },
      ],
    },
    { kind: "attestation", text: platformAttestation(input.verificationUrl), verificationUrl: input.verificationUrl },
  );

  return {
    reference: input.reference,
    contentHash: "",
    blocks,
    meta: {
      hostelName: input.hostelName,
      ownerName: input.ownerName,
      tenantName: input.tenantName,
      versionNumber: input.versionNumber,
      generatedAt: input.generatedAt,
      status: input.status,
    },
  };
}
