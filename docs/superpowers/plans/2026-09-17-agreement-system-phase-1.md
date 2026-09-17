# Agreement System Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the document a tenant reads before signing be the same document the owner drafted and the same document the PDF is made from — and stop tenants signing a document that does not yet exist.

**Architecture:** One pure composer on the backend turns a snapshot plus platform boilerplate into an ordered `AgreementDocument` (blocks). That model is served as JSON to the tenant reader, and consumed by the existing pdf-lib renderer for its text content. A SHA-256 `contentHash` over the normalised blocks makes "what was read == what was signed" checkable rather than aspirational.

**Tech Stack:** Next.js 14 App Router, Prisma, Postgres (Supabase), vitest (backend, single-worker, real DB), Vite + React 19 (frontend), vitest node-environment `.test.ts` only, pdf-lib + fontkit.

**Spec:** `docs/superpowers/specs/2026-09-17-agreement-system-redesign-design.md`

## Global Constraints

- **Frontend tests are node-environment only.** Match `src/**/*.test.ts`, never `.test.tsx`. No jsdom, no component rendering. Decision logic goes in pure `.ts`; components stay thin renderers.
- **Backend tests share a real Postgres connection** and run single-worker (`fileParallelism: false`). Do not parallelise.
- **Run `npm test` on the backend, not `npm run test:pure`.**
- **Deploy before migrate.** Adding fields to `schema.prisma` has taken production down in this repo. Prisma client ships first, migration second.
- **Money is integer paise** wherever payment precision matters. Agreement contract amounts are `Decimal` — do not convert.
- **A signed agreement is never re-composed against the current template.** It renders from its own `rules_snapshot` / `content_snapshot`.
- **Variable tokens written by new code are `{{VAR}}`** (double brace). The reader accepts both formats.
- **Branch off `dev`, after pulling `main`. Never commit to `main`.**
- **Migration and ADR numbers are chosen after pulling**, not from this checkout. `migrations/` here tops out at `082` but `083` is recorded as applied on prod, and ADR numbers have collided before. Last known ADR: **213**.
- **Do not touch `SignatureSheet`.** Draw-or-upload with client-side background removal (ADR-140) is correct and stays.
- **Do not touch renewals.** Out of scope.

## Corrections to the spec, discovered during planning

These supersede the spec where they conflict. Fold them back into the spec file as part of Task 0.

1. **Tenant onboarding is token-authenticated, not session-authenticated.** `/tenants/activate*` routes resolve the subject via `activationSubjectFromRequest`, not `getSession`. So the spec's single `GET /api/agreements/[id]/document` cannot serve onboarding. **Two read endpoints are needed** (Tasks 6 and 7).
2. **There are two content bands, not one.** The PDF renders `termsAndConditions` as numbered legal clauses *and* `hostelRules.categories` as an incorporated-by-reference "HOSTEL RULES & REGULATIONS" section. The owner's editor only edits the second. The `section` block therefore needs a `band: 'terms' | 'rules'` discriminator, and Phase 2 must decide whether owners get to edit the `terms` band at all.
3. **The PDF refactor is content-only.** `generatePdfBuffer` is ~700 lines of imperative pdf-lib drawing. The composer takes over *what* is drawn (text, order, numbering, interpolation); the renderer keeps *how* entirely. Do not rewrite the drawing code.

---

### Task 0: Branch, sync, and fold the corrections into the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-agreement-system-redesign-design.md`

**Interfaces:**
- Consumes: nothing
- Produces: a clean branch off `dev`; the corrected spec

- [ ] **Step 1: Sync and branch**

```bash
git fetch origin
git checkout dev && git pull origin dev
git checkout -b feat/agreement-document-model
```

- [ ] **Step 2: Record the real next migration and ADR numbers**

```bash
ls migrations/ | grep -E '^[0-9]{3}_' | sort | tail -3
grep -oE 'ADR-[0-9]+' docs/obsidian/Decisions.md | sort -u | tail -3
```

Write both into the spec's §12 Open items table, replacing "chosen after pulling".

- [ ] **Step 3: Add the three corrections above to spec §3.6, §3.2 and §3.3**

In §3.6, replace the single tenant row with two rows: `GET /api/tenants/activate/agreement-document?token=` (onboarding, token auth) and `GET /api/agreements/[id]/document` (authenticated). In §3.2, add `band: 'terms' | 'rules'` to the `section` block. In §3.3, state that the PDF refactor is content-only.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-agreement-system-redesign-design.md
git commit -m "docs(spec): correct agreement design for token auth and two content bands"
```

---

### Task 1: Accept both token formats

Fixes audit issue #1 — the highest-harm defect. Every variable an owner inserts today prints literally in a signed PDF.

**Files:**
- Modify: `apps/backend/src/utils/default-rules.ts:152-161`
- Test: `apps/backend/tests/agreement-interpolation.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `interpolateText(text: string, variables: Record<string, any>, isFinal?: boolean): string` — unchanged signature, widened behaviour.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { interpolateText, interpolateRulesContent } from "@/src/utils/default-rules";

const vars = { MONTHLY_RENT: 8000, TENANT_NAME: "Ravi Kumar" };

describe("interpolateText", () => {
  it("substitutes the double-brace form", () => {
    expect(interpolateText("Rent is {{MONTHLY_RENT}}.", vars)).toBe("Rent is 8000.");
  });

  it("substitutes the single-brace form written by the owner editor", () => {
    expect(interpolateText("Rent is {MONTHLY_RENT}.", vars)).toBe("Rent is 8000.");
  });

  it("substitutes both forms in one string", () => {
    expect(interpolateText("{TENANT_NAME} pays {{MONTHLY_RENT}}.", vars)).toBe("Ravi Kumar pays 8000.");
  });

  it("tolerates internal whitespace", () => {
    expect(interpolateText("Rent is {{ MONTHLY_RENT }}.", vars)).toBe("Rent is 8000.");
  });

  it("leaves a mismatched pair alone rather than silently repairing it", () => {
    expect(interpolateText("Rent is {MONTHLY_RENT}}.", vars)).toBe("Rent is 8000}.");
  });

  it("leaves an unknown token visible when not final", () => {
    expect(interpolateText("Hi {{NOPE}}.", vars)).toBe("Hi {{NOPE}}.");
    expect(interpolateText("Hi {NOPE}.", vars)).toBe("Hi {NOPE}.");
  });

  it("blanks an unknown token when final", () => {
    expect(interpolateText("Hi {{NOPE}}.", vars, true)).toBe("Hi ____.");
    expect(interpolateText("Hi {NOPE}.", vars, true)).toBe("Hi ____.");
  });

  it("does not treat lowercase braces as tokens", () => {
    expect(interpolateText("Use {rent} here.", vars)).toBe("Use {rent} here.");
  });
});

describe("interpolateRulesContent", () => {
  it("interpolates both forms across highlights and rules", () => {
    const out = interpolateRulesContent(
      { categories: [{ id: "a", title: "Fees", highlights: ["Rent {MONTHLY_RENT}"], rules: ["Due {{MONTHLY_RENT}}"] }] },
      vars,
    );
    expect(out.categories[0].highlights[0]).toBe("Rent 8000");
    expect(out.categories[0].rules[0]).toBe("Due 8000");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-interpolation.test.ts
```

Expected: the single-brace cases FAIL — currently `{MONTHLY_RENT}` passes through untouched.

- [ ] **Step 3: Widen the regex**

Replace the body of `interpolateText` (`src/utils/default-rules.ts:152-161`) with:

```ts
/**
 * Substitutes `{{VAR}}` and `{VAR}`.
 *
 * Both forms exist in the wild: the stock template and the backend have always
 * written `{{VAR}}`, but the owner editor's insert chips wrote `{VAR}`, which
 * this function did not match — so every variable an owner inserted printed
 * literally in their tenants' signed PDFs.
 *
 * Written as two explicit alternatives rather than optional braces
 * (`\{\{?…\}\}?`), which would also match mismatched pairs such as `{VAR}}` and
 * silently "repair" malformed input instead of leaving it visible.
 */
export function interpolateText(text: string, variables: Record<string, any>, isFinal: boolean = false): string {
  if (!text) return "";
  return text.replace(
    /\{\{\s*([A-Z0-9_]+)\s*\}\}|\{\s*([A-Z0-9_]+)\s*\}/g,
    (match, doubleKey, singleKey) => {
      const key = (doubleKey ?? singleKey).trim();
      const value = variables[key];
      if (value !== undefined && value !== null) return String(value);
      return isFinal ? "____" : match;
    },
  );
}
```

- [ ] **Step 4: Run the test and the existing agreement suite**

```bash
cd apps/backend && npx vitest run tests/agreement-interpolation.test.ts
npx vitest run tests/agreement-rules-snapshot.test.ts tests/agreement-content.test.ts tests/agreement-template-validation.test.ts
```

Expected: all PASS. If a snapshot test fails because a fixture contained a literal `{WORD}` that now substitutes, that is the bug being fixed — update the fixture, do not narrow the regex.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/utils/default-rules.ts apps/backend/tests/agreement-interpolation.test.ts
git commit -m "fix(agreements): substitute single-brace variable tokens

The owner editor's insert chips write {VAR} but the interpolator only
matched {{VAR}}, so every variable an owner inserted printed literally
in their tenants' signed agreements."
```

---

### Task 2: Move the boilerplate module under services

A pure move so the composer can own it without importing from the PDF layer. No behaviour change.

**Files:**
- Create: `apps/backend/src/services/agreements/agreement-boilerplate.ts` (moved from `apps/backend/lib/pdf/agreement-content.ts`)
- Create: `apps/backend/lib/pdf/agreement-content.ts` (re-export shim)
- Modify: `apps/backend/tests/agreement-content.test.ts` (import path)

**Interfaces:**
- Consumes: nothing
- Produces: `rupees`, `clauseBody`, `numberClauses`, `placeFromAddress`, `preamble`, `standardLegalClauses`, `executionStatement`, `pageFooter`, `platformAttestation`, `type Clause`, `type AgreementContentInput` — all from `@/src/services/agreements/agreement-boilerplate`.

- [ ] **Step 1: Move the file, keeping its header comment verbatim**

```bash
cd /home/sp/Desktop/stayo
mkdir -p apps/backend/src/services/agreements
git mv apps/backend/lib/pdf/agreement-content.ts apps/backend/src/services/agreements/agreement-boilerplate.ts
```

- [ ] **Step 2: Add a re-export shim at the old path**

```ts
// apps/backend/lib/pdf/agreement-content.ts
/**
 * Moved to `src/services/agreements/agreement-boilerplate.ts`.
 *
 * The boilerplate is no longer the PDF renderer's private helper — it is an
 * input to the document composer, which the PDF renderer now consumes. This
 * shim exists so the move is not a breaking change for callers; remove it once
 * nothing imports from here.
 */
export * from "@/src/services/agreements/agreement-boilerplate";
```

- [ ] **Step 3: Point the existing test at the new path**

In `apps/backend/tests/agreement-content.test.ts`, change the import from `"@/lib/pdf/agreement-content"` to `"@/src/services/agreements/agreement-boilerplate"`.

- [ ] **Step 4: Run the suite to prove nothing moved but the file**

```bash
cd apps/backend && npx vitest run tests/agreement-content.test.ts && npm run build
```

Expected: PASS, and the build resolves both paths.

- [ ] **Step 5: Commit**

```bash
git add -A apps/backend/lib/pdf apps/backend/src/services/agreements apps/backend/tests/agreement-content.test.ts
git commit -m "refactor(agreements): move boilerplate out of the pdf layer"
```

---

### Task 3: The document composer

The heart of the design. Pure — no Prisma, no pdf-lib, no I/O.

**Files:**
- Create: `apps/backend/src/services/agreements/agreement-document.ts`
- Test: `apps/backend/tests/agreement-document.test.ts`

**Interfaces:**
- Consumes: `preamble`, `standardLegalClauses`, `executionStatement`, `platformAttestation`, `numberClauses`, `clauseBody`, `placeFromAddress` from Task 2; `interpolateText` from Task 1.
- Produces:
  - `type DocBlock`, `type SignaturePanel`, `type AgreementDocument`, `type AgreementDocumentInput`
  - `buildAgreementDocument(input: AgreementDocumentInput): AgreementDocument` (with `contentHash: ""` — Task 4 fills it)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildAgreementDocument, type AgreementDocumentInput } from "@/src/services/agreements/agreement-document";

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
  signatures: { tenantName: "B. Vineeth", tenantSignatureUrl: null, guardianName: null, guardianSignatureUrl: null, guardianRelation: null, ownerSignatureUrl: null },
  ...over,
});

const kinds = (doc = buildAgreementDocument(input())) => doc.blocks.map((b) => b.kind);

describe("buildAgreementDocument", () => {
  it("emits the blocks in the fixed contractual order", () => {
    expect(kinds()).toEqual([
      "title", "preamble", "facts", "section", "section", "section", "execution", "signatures", "attestation",
    ]);
  });

  it("puts every owner section before every platform section", () => {
    const sections = buildAgreementDocument(input()).blocks.filter((b) => b.kind === "section") as any[];
    const lastOwner = sections.map((s) => s.origin).lastIndexOf("owner");
    const firstPlatform = sections.map((s) => s.origin).indexOf("platform");
    expect(lastOwner).toBeLessThan(firstPlatform);
  });

  it("marks the terms band and the rules band", () => {
    const sections = buildAgreementDocument(input()).blocks.filter((b) => b.kind === "section") as any[];
    expect(sections.map((s) => s.band)).toEqual(["terms", "rules", "terms"]);
  });

  it("numbers sections continuously across both bands", () => {
    const sections = buildAgreementDocument(input()).blocks.filter((b) => b.kind === "section") as any[];
    expect(sections.map((s) => s.number)).toEqual([1, 2, 3]);
  });

  it("interpolates clause text", () => {
    const rules = (buildAgreementDocument(input()).blocks.filter((b) => b.kind === "section") as any[])
      .find((s) => s.band === "rules");
    expect(rules.clauses[0].text).toBe("Rent is 8,000");
  });

  it("omits a section the owner switched off", () => {
    const titles = (buildAgreementDocument(input()).blocks.filter((b) => b.kind === "section") as any[]).map((s) => s.title);
    expect(titles).not.toContain("Excluded");
  });

  it("treats a section with no enabled flag as included", () => {
    const doc = buildAgreementDocument(input({ rules: { categories: [{ id: "x", title: "Legacy", rules: ["Kept."] }] } }));
    const titles = (doc.blocks.filter((b) => b.kind === "section") as any[]).map((s) => s.title);
    expect(titles).toContain("Legacy");
  });

  it("strips a title the stored clause body repeats", () => {
    const terms = (buildAgreementDocument(input()).blocks.filter((b) => b.kind === "section") as any[])
      .find((s) => s.title === "Notice Period");
    expect(terms.clauses[0].text).toBe("Either party may give 30 days notice.");
  });

  it("carries severity through so the reader can surface highlights", () => {
    const rules = (buildAgreementDocument(input()).blocks.filter((b) => b.kind === "section") as any[])
      .find((s) => s.band === "rules");
    expect(rules.severity).toBe("important");
  });

  it("always emits execution, signatures and attestation even with no owner content", () => {
    expect(kinds(buildAgreementDocument(input({ rules: { categories: [] }, terms: [] })))).toEqual([
      "title", "preamble", "facts", "section", "execution", "signatures", "attestation",
    ]);
  });

  it("cannot be made to drop the execution block by owner content", () => {
    const doc = buildAgreementDocument(input({
      rules: { categories: [{ id: "evil", title: "execution", rules: ["Nope."] }] },
    }));
    expect(doc.blocks.filter((b) => b.kind === "execution")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-document.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the composer**

```ts
// apps/backend/src/services/agreements/agreement-document.ts
/**
 * The agreement, as an ordered list of blocks.
 *
 * PURE MODULE — no Prisma, no pdf-lib, no I/O. Tested directly.
 *
 * This exists because the document an owner drafted, the document a tenant was
 * shown, and the PDF that was generated were three different artifacts
 * composed by three different pieces of code. They are now one model with two
 * renderers: HTML in the tenant app, pdf-lib on the server.
 *
 * **Block order is decided here, not by data.** Owner content can only occupy
 * the `origin: 'owner'` band; there is no input by which an owner can displace
 * the execution statement or the attestation. That is what makes the legal
 * frame guarded rather than merely validated.
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
  rules: { categories?: Array<{ id: string; title: string; severity?: string; highlights?: string[]; rules?: string[]; enabled?: boolean }> } | null;
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
function isEnabled(category: { enabled?: boolean }): boolean {
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

  // ── The owner band ───────────────────────────────────────────────────────
  // The hostel's own terms lead, then the hostel's own rules. Numbering is a
  // single running sequence so the document reads as one instrument.
  let number = 0;

  for (const term of input.terms) {
    number += 1;
    blocks.push({
      kind: "section",
      number,
      title: term.title.trim(),
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
      title: category.title.trim(),
      clauses: lines.map((line, index) => ({ number: `${number}.${index + 1}`, text: fill(line) })),
      origin: "owner",
      band: "rules",
      severity: category.severity === "important" ? "important" : "standard",
    });
  }

  // ── The guarded platform band ────────────────────────────────────────────
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
```

- [ ] **Step 4: Run the test**

```bash
cd apps/backend && npx vitest run tests/agreement-document.test.ts
```

Expected: PASS, all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/agreements/agreement-document.ts apps/backend/tests/agreement-document.test.ts
git commit -m "feat(agreements): compose the agreement as an ordered block model"
```

---

### Task 4: The content hash

**Files:**
- Modify: `apps/backend/src/services/agreements/agreement-document.ts`
- Test: `apps/backend/tests/agreement-document-hash.test.ts`

**Interfaces:**
- Consumes: `buildAgreementDocument`, `type DocBlock` from Task 3
- Produces: `hashAgreementDocument(blocks: DocBlock[]): string` — 64-char lowercase hex. `buildAgreementDocument` now returns a populated `contentHash`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildAgreementDocument, hashAgreementDocument } from "@/src/services/agreements/agreement-document";
// Reuse the same `input()` factory as tests/agreement-document.test.ts —
// copy it in; these two files are read independently.

describe("hashAgreementDocument", () => {
  it("is a 64-character lowercase hex digest", () => {
    expect(hashAgreementDocument(buildAgreementDocument(input()).blocks)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls with identical content", () => {
    expect(hashAgreementDocument(buildAgreementDocument(input()).blocks))
      .toBe(hashAgreementDocument(buildAgreementDocument(input()).blocks));
  });

  it("ignores generatedAt, which is not part of the agreed content", () => {
    const a = buildAgreementDocument(input({ generatedAt: "2026-01-01T00:00:00.000Z" }));
    const b = buildAgreementDocument(input({ generatedAt: "2026-12-31T00:00:00.000Z" }));
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("ignores signature images, which are applied after the content is agreed", () => {
    const signed = input({ signatures: { ...input().signatures, tenantSignatureUrl: "https://img/sig.png" } });
    expect(buildAgreementDocument(signed).contentHash).toBe(buildAgreementDocument(input()).contentHash);
  });

  it("changes when a clause is reworded", () => {
    const changed = input({ terms: [{ title: "Notice Period", content: "Sixty days notice." }] });
    expect(buildAgreementDocument(changed).contentHash).not.toBe(buildAgreementDocument(input()).contentHash);
  });

  it("changes when sections are reordered", () => {
    const base = input();
    const swapped = input({ rules: { categories: [...(base.rules!.categories ?? [])].reverse() } });
    expect(buildAgreementDocument(swapped).contentHash).not.toBe(buildAgreementDocument(base).contentHash);
  });

  it("is populated on the built document", () => {
    const doc = buildAgreementDocument(input());
    expect(doc.contentHash).toBe(hashAgreementDocument(doc.blocks));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-document-hash.test.ts
```

Expected: FAIL — `hashAgreementDocument` is not exported.

- [ ] **Step 3: Implement**

Add to `agreement-document.ts`:

```ts
import { createHash } from "crypto";

/**
 * A digest of what the parties agreed to.
 *
 * Deliberately narrow: text and order only. `generatedAt` and the signature
 * images are excluded because they are not content — the same agreement
 * rendered twice, or rendered before and after signing, must hash the same.
 * That is the whole point: it lets us assert that the document a tenant read
 * and the PDF produced afterwards are the same document.
 */
export function hashAgreementDocument(blocks: DocBlock[]): string {
  const normalised = blocks.map((block) => {
    switch (block.kind) {
      case "title":
        return ["title", block.text, block.subtitle ?? ""];
      case "preamble":
      case "execution":
        return [block.kind, block.text];
      case "facts":
        return ["facts", ...block.rows.map((r) => `${r.label}=${r.value}`)];
      case "section":
        return ["section", block.band, block.origin, String(block.number), block.title,
                ...block.clauses.map((c) => `${c.number}|${c.text}`)];
      case "signatures":
        // Roles and order, never the images or the names filled in later.
        return ["signatures", ...block.panels.map((p) => p.role)];
      case "attestation":
        return ["attestation", block.text];
    }
  });
  return createHash("sha256").update(JSON.stringify(normalised)).digest("hex");
}
```

And in `buildAgreementDocument`, replace `contentHash: ""` by computing it from the finished blocks:

```ts
  return {
    reference: input.reference,
    contentHash: hashAgreementDocument(blocks),
    blocks,
    meta: { /* unchanged */ },
  };
```

- [ ] **Step 4: Run both document tests**

```bash
cd apps/backend && npx vitest run tests/agreement-document.test.ts tests/agreement-document-hash.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/agreements/agreement-document.ts apps/backend/tests/agreement-document-hash.test.ts
git commit -m "feat(agreements): hash the composed document content"
```

---

### Task 5: Resolve a stored agreement into composer input

The only impure piece. Thin by design — it reads, it maps, it does not decide.

**Files:**
- Create: `apps/backend/src/services/agreements/agreement-document-resolver.ts`
- Test: `apps/backend/tests/agreement-document-resolver.test.ts`

**Interfaces:**
- Consumes: `AgreementDocumentInput` from Task 3; `formatAgreementDate` and `type AgreementData` from `agreement-generation-service.ts`; `rupees` from Task 2.
- Produces: `agreementDocumentInputFromRenderData(data: AgreementData, opts: { reference: string; versionNumber: number; status: string; verificationUrl: string | null }): AgreementDocumentInput` — **pure**, and the whole of this module's public surface.

> There is deliberately **no** `resolveAgreementDocumentInput(agreementId)` convenience wrapper. Tasks 6, 7 and 10 all already hold the loaded agreement row (they need `version_number` and `status` from it, which `getAgreementRenderData` does not return), so a wrapper that re-fetched and then guessed those values would be both a second query and a source of wrong metadata.

- [ ] **Step 1: Write the failing test for the pure mapper**

```ts
import { describe, expect, it } from "vitest";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";

const renderData: any = {
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  roomNo: "101",
  monthlyRent: 8000,
  advanceDeposit: 16000,
  maintenanceCharge: 500,
  maintenanceType: "MONTHLY",
  joiningDate: "2026-09-01T00:00:00.000Z",
  paymentFrequency: "Monthly",
  hostelRules: { categories: [{ id: "a", title: "Fees", rules: ["Due on the 5th."] }] },
  termsAndConditions: [{ title: "Notice Period", content: "Thirty days." }],
  tenantSignatureName: "B. Vineeth",
  tenantSignatureUrl: null,
  guardianSignatureName: null,
  guardianSignatureUrl: null,
  guardianRelation: null,
  ownerSignatureUrl: "https://img/owner.png",
  ownerSignedAt: "2026-09-17T00:00:00.000Z",
  agreementStartDate: "2026-09-01T00:00:00.000Z",
};

const opts = { reference: "AGR-42", versionNumber: 3, status: "SIGNED", verificationUrl: null };

describe("agreementDocumentInputFromRenderData", () => {
  it("builds the facts table in contractual order", () => {
    const out = agreementDocumentInputFromRenderData(renderData, opts);
    expect(out.facts.map((f) => f.label)).toEqual([
      "Room", "Joining Date", "Monthly Rent", "Security Deposit", "Maintenance", "Payment Cycle",
    ]);
  });

  it("formats money with the rupee symbol", () => {
    const out = agreementDocumentInputFromRenderData(renderData, opts);
    expect(out.facts.find((f) => f.label === "Monthly Rent")!.value).toBe("₹8,000");
  });

  it("renders a zero maintenance charge as a dash rather than a fake amount", () => {
    const out = agreementDocumentInputFromRenderData({ ...renderData, maintenanceCharge: 0 }, opts);
    expect(out.facts.find((f) => f.label === "Maintenance")!.value).toBe("—");
  });

  it("is final, because a stored agreement is being issued not drafted", () => {
    expect(agreementDocumentInputFromRenderData(renderData, opts).isFinal).toBe(true);
  });

  it("carries the eight substitution variables", () => {
    const out = agreementDocumentInputFromRenderData(renderData, opts);
    expect(Object.keys(out.variables).sort()).toEqual([
      "HOSTEL_NAME", "JOINING_DATE", "MAINTENANCE_CHARGE_AMOUNT", "MONTHLY_RENT",
      "OWNER_NAME", "ROOM_NUMBER", "SECURITY_DEPOSIT_AMOUNT", "TENANT_NAME",
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-document-resolver.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/services/agreements/agreement-document-resolver.ts
/**
 * Stored agreement → composer input.
 *
 * Split in two on purpose: `agreementDocumentInputFromRenderData` is pure and
 * carries every decision (which facts, in what order, how money reads), and is
 * tested directly. The async wrapper only fetches.
 *
 * It reuses `getAgreementRenderData`, which is already snapshot-first — a
 * signed agreement must render from what was signed, never from the hostel's
 * current template.
 */
import { rupees } from "./agreement-boilerplate";
import type { AgreementDocumentInput } from "./agreement-document";
import { formatAgreementDate, type AgreementData } from "../tenants/agreement-generation-service";

export function agreementDocumentInputFromRenderData(
  data: AgreementData,
  opts: { reference: string; versionNumber: number; status: string; verificationUrl: string | null },
): AgreementDocumentInput {
  const joining = formatAgreementDate(data.agreementStartDate || data.joiningDate);
  const maintenance = Number(data.maintenanceCharge || 0);

  return {
    reference: opts.reference,
    hostelName: data.hostelName,
    hostelAddress: data.hostelAddress,
    ownerName: data.ownerName,
    tenantName: data.tenantName,
    versionNumber: opts.versionNumber,
    status: opts.status,
    generatedAt: new Date().toISOString(),
    executionDateDisplay: data.ownerSignedAt
      ? formatAgreementDate(data.ownerSignedAt)
      : formatAgreementDate(data.agreementStartDate || data.joiningDate),
    verificationUrl: opts.verificationUrl,
    facts: [
      { label: "Room", value: data.roomNo || "—" },
      { label: "Joining Date", value: joining },
      { label: "Monthly Rent", value: rupees(Number(data.monthlyRent || 0)) },
      { label: "Security Deposit", value: rupees(Number(data.advanceDeposit || 0)) },
      { label: "Maintenance", value: maintenance > 0 ? `${rupees(maintenance)}/mo` : "—" },
      { label: "Payment Cycle", value: data.paymentFrequency || "Monthly" },
    ],
    terms: data.termsAndConditions ?? [],
    rules: data.hostelRules ?? null,
    variables: {
      TENANT_NAME: data.tenantName,
      ROOM_NUMBER: data.roomNo || "",
      MONTHLY_RENT: Number(data.monthlyRent || 0),
      SECURITY_DEPOSIT_AMOUNT: Number(data.advanceDeposit || 0),
      MAINTENANCE_CHARGE_AMOUNT: maintenance,
      HOSTEL_NAME: data.hostelName,
      OWNER_NAME: data.ownerName,
      JOINING_DATE: joining,
    },
    // A stored agreement is being issued, not drafted: an unresolved token
    // must blank rather than print as a token in something being signed.
    isFinal: true,
    signatures: {
      tenantName: data.tenantSignatureName ?? null,
      tenantSignatureUrl: data.tenantSignatureUrl ?? null,
      guardianName: data.guardianSignatureName ?? null,
      guardianSignatureUrl: data.guardianSignatureUrl ?? null,
      guardianRelation: data.guardianRelation ?? null,
      ownerSignatureUrl: data.ownerSignatureUrl ?? null,
    },
  };
}
```

> `getAgreementRenderData` does not return `versionNumber`, `status` or a verification URL. That is why they are `opts` — every caller already has the agreement row in hand.

- [ ] **Step 4: Run the test**

```bash
cd apps/backend && npx vitest run tests/agreement-document-resolver.test.ts
```

Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/agreements/agreement-document-resolver.ts apps/backend/tests/agreement-document-resolver.test.ts
git commit -m "feat(agreements): resolve a stored agreement into composer input"
```

---

### Task 6: The onboarding document endpoint (token-authenticated)

**Files:**
- Create: `apps/backend/app/api/tenants/activate/agreement-document/route.ts`
- Test: `apps/backend/tests/agreement-document-endpoint.test.ts`

**Interfaces:**
- Consumes: `agreementDocumentInputFromRenderData` (Task 5), `buildAgreementDocument` (Task 3), `activationSubjectFromRequest`, `tenantInvitationLifecycleService`.
- Produces: `GET /api/tenants/activate/agreement-document?token=<token>` → `{ document: AgreementDocument }`.

- [ ] **Step 1: Write the failing test**

**Route tests in this repo mock Prisma — they do not touch the database.** Copy the harness from `apps/backend/tests/activate-documents-route.test.ts` verbatim and adapt it:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, mockLifecycle, mockSubject, mockRenderData } = vi.hoisted(() => {
  const prisma: any = { agreement: { findFirst: vi.fn() } };
  return {
    mockPrisma: prisma,
    mockLifecycle: { resolveByToken: vi.fn(), resolveForSession: vi.fn() },
    mockSubject: vi.fn(),
    mockRenderData: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
  apiResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), { status }),
}));
vi.mock("@/src/services/tenants/activation-request-subject", () => ({
  activationSubjectFromRequest: mockSubject,
}));
vi.mock("@/src/services/tenants/tenant-invitation-lifecycle-service", () => ({
  tenantInvitationLifecycleService: mockLifecycle,
}));
vi.mock("@/src/services/tenants/agreement-generation-service", () => ({
  AgreementGenerationService: { getAgreementRenderData: mockRenderData },
  formatAgreementDate: (d: any) => String(d),
}));
```

Note the subject shape: `activationSubjectFromRequest` resolves to `{ ok: true, mode: "token", token }`, `{ ok: true, mode: "session", tenantId }`, or `{ ok: false }` — **not** a bare tenant id.

Assert:

```ts
it("returns 401 without a token", async () => { /* GET with no token → 401 */ });
it("returns 404 when the activation subject has no agreement", async () => { /* … */ });
it("returns the composed document for a valid token", async () => {
  // → 200, body.document.blocks[0].kind === "title"
  // → body.document.contentHash matches /^[0-9a-f]{64}$/
});
it("does not leak another tenant's agreement", async () => {
  // token for tenant A must not return tenant B's agreement
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-document-endpoint.test.ts
```

Expected: FAIL — route does not exist (404 on every case).

- [ ] **Step 3: Implement the route**

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activationSubjectFromRequest } from "@/src/services/tenants/activation-request-subject";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { AgreementGenerationService } from "@/src/services/tenants/agreement-generation-service";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";
import { buildAgreementDocument } from "@/src/services/agreements/agreement-document";

/**
 * The document a tenant reads before signing.
 *
 * Token-authenticated, not session-authenticated: onboarding happens before
 * the tenant has an account, so this cannot sit behind `getSession`.
 *
 * It composes from the agreement's own snapshot, so what is read here is
 * exactly what the PDF will be generated from — see `contentHash`.
 */
/**
 * Resolve the tenant from a token or a session, exactly as
 * `app/api/tenants/activate/documents/route.ts` does. The subject is a
 * discriminated union, not a tenant id — token mode has to go through the
 * lifecycle service to reach a tenant.
 */
async function resolveTenant(req: NextRequest, token: string | null) {
  const subject = await activationSubjectFromRequest(req, token);
  if (!subject.ok) return { tenant: null, error: apiError("token is required", "VALIDATION_ERROR", 400) };

  const resolved = subject.mode === "session"
    ? await tenantInvitationLifecycleService.resolveForSession(String(subject.tenantId || ""))
    : await tenantInvitationLifecycleService.resolveByToken(String(subject.token || ""));
  if (!resolved.tenant) return { tenant: null, error: apiError("Invalid or expired activation link", "INVALID", 410) };

  return { tenant: resolved.tenant, error: null };
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    const { tenant, error } = await resolveTenant(req, token);
    if (error) return error;

    const agreement = await prisma.agreement.findFirst({
      where: { tenant_id: tenant!.id },
      orderBy: { generated_at: "desc" },
      include: { template: { select: { version_number: true } } },
    });
    if (!agreement) return apiError("No agreement found", "NOT_FOUND", 404);

    const data = await AgreementGenerationService.getAgreementRenderData(agreement.id);
    const document = buildAgreementDocument(
      agreementDocumentInputFromRenderData(data, {
        reference: agreement.id,
        versionNumber: agreement.template?.version_number ?? 1,
        status: agreement.status,
        verificationUrl: null,
      }),
    );

    return apiResponse({ document });
  } catch (error: any) {
    return apiError(error?.message || "Failed to load agreement document", "INTERNAL_ERROR", 500);
  }
}
```

> `resolveTenant` is duplicated from the documents route rather than shared, matching how `/activate/photo` and `/activate/documents` already each carry their own copy. If a third caller appears in Phase 2, extract it then.

- [ ] **Step 4: Run the test**

```bash
cd apps/backend && npx vitest run tests/agreement-document-endpoint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/tenants/activate/agreement-document apps/backend/tests/agreement-document-endpoint.test.ts
git commit -m "feat(agreements): serve the composed document to onboarding tenants"
```

---

### Task 7: The authenticated document endpoint

For already-activated tenants re-reading their agreement, and owners viewing an issued one.

**Files:**
- Create: `apps/backend/app/api/agreements/[id]/document/route.ts`
- Test: `apps/backend/tests/agreement-document-endpoint-auth.test.ts`

**Interfaces:**
- Consumes: same as Task 6, plus `getSession`.
- Produces: `GET /api/agreements/[id]/document` → `{ document: AgreementDocument }`.

- [ ] **Step 1: Write the failing test**

Same mocked-Prisma harness as Task 6, but mock `@/lib/auth`'s `getSession` instead of the activation subject.

```ts
it("returns 403 without a session", async () => { /* … */ });
it("lets the tenant who signed it read their own agreement", async () => { /* 200 */ });
it("lets the owner of the hostel read it", async () => { /* 200 */ });
it("refuses a different owner", async () => { /* 403 or 404, never the body */ });
it("refuses a different tenant", async () => { /* 403 or 404 */ });
```

This authorisation test matters: the repo already carries an open IDOR finding on an agreement route. Do not skip the two negative cases.

For each case, drive `mockPrisma.agreement.findFirst` to return a row whose `hostel.owner_id` and `tenant.profile_id` differ from the mocked session's `sub`, and assert the response status **and** that the body carries no `document` key.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-document-endpoint-auth.test.ts
```

Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

Same composition as Task 6, but resolve the subject with `getSession(req)` and authorise explicitly: load the agreement with `{ tenant: { select: { profile_id: true } }, hostel: { select: { owner_id: true } } }`, then allow only when `session.sub === agreement.hostel.owner_id` (owner/admin) or `session.sub === agreement.tenant.profile_id` (the signatory). **Never fall back to "first hostel"** — `check:invariants` will reject it and it is the exact class of bug that check exists for.

- [ ] **Step 4: Run the test and the invariant check**

```bash
cd apps/backend && npx vitest run tests/agreement-document-endpoint-auth.test.ts && npm run check:invariants
```

Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/agreements apps/backend/tests/agreement-document-endpoint-auth.test.ts
git commit -m "feat(agreements): serve the composed document to authenticated readers"
```

---

### Task 8: Schema — read-tracking columns

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (model `Agreement`, after `signed_at`)
- Create: `migrations/<NNN>_agreement_read_tracking.sql` — number from Task 0 Step 2

**Interfaces:**
- Consumes: nothing
- Produces: `Agreement.document_content_hash`, `Agreement.document_opened_at`, `Agreement.document_read_completed_at`

- [ ] **Step 1: Add the fields to the Prisma model**

```prisma
  // What the tenant actually read, and that they read it. The document a
  // tenant signs used to be generated only after signing; these record the
  // read that now precedes it. See ADR-<N>.
  document_content_hash      String?
  document_opened_at         DateTime? @db.Timestamptz(6)
  document_read_completed_at DateTime? @db.Timestamptz(6)
```

- [ ] **Step 2: Regenerate the client and confirm the build**

```bash
cd apps/backend && npm run prisma:generate && npm run build
```

Expected: clean build.

- [ ] **Step 3: Write the migration**

```sql
-- migrations/<NNN>_agreement_read_tracking.sql
-- Records that a tenant opened and finished reading their agreement before
-- signing it, and a digest of what they read. All additive and nullable:
-- existing agreements predate the read gate and must not be invalidated.
ALTER TABLE agreements
  ADD COLUMN IF NOT EXISTS document_content_hash      TEXT,
  ADD COLUMN IF NOT EXISTS document_opened_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS document_read_completed_at TIMESTAMPTZ;
```

> Confirm the real table name (`agreements`) with `grep -n '@@map' apps/backend/prisma/schema.prisma` around the `Agreement` model before running this.

- [ ] **Step 4: Verify the columns resolve**

```bash
cd apps/backend && npx vitest run tests/agreement-status-semantics.test.ts
```

Expected: PASS — proves the regenerated client still matches the live schema.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/schema.prisma migrations/
git commit -m "feat(agreements): record that the tenant read the document

Deploy before migrating: the Prisma client ships first."
```

---

### Task 9: The read-progress endpoint

**Files:**
- Create: `apps/backend/app/api/tenants/activate/agreement-read/route.ts`
- Test: `apps/backend/tests/agreement-read-progress.test.ts`

**Interfaces:**
- Consumes: `activationSubjectFromRequest`; the columns from Task 8
- Produces: `POST /api/tenants/activate/agreement-read` with body `{ token: string; stage: 'opened' | 'completed'; content_hash: string }` → `{ opened_at, read_completed_at }`

- [ ] **Step 1: Write the failing test**

Same mocked-Prisma harness as Task 6, adding `agreement: { findFirst: vi.fn(), update: vi.fn() }` to the mock client and asserting against `mockPrisma.agreement.update.mock.calls`.

```ts
it("stamps document_opened_at on the opened stage", async () => { /* … */ });
it("stamps document_read_completed_at and the hash on the completed stage", async () => { /* … */ });
it("does not move opened_at backwards on a second open", async () => {
  // Re-opening must not reset the first-read evidence.
});
it("rejects a stage it does not know", async () => { /* 400 */ });
it("rejects a content hash that is not 64 hex chars", async () => { /* 400 */ });
it("requires a valid activation token", async () => { /* 401 */ });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-read-progress.test.ts
```

Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

Resolve the subject from the token; find the tenant's latest agreement; then:

```ts
const now = new Date();
const data =
  stage === "opened"
    // `??` not `=`: the first open is the evidence, a re-read must not reset it.
    ? { document_opened_at: agreement.document_opened_at ?? now }
    : { document_read_completed_at: now, document_content_hash: contentHash, document_opened_at: agreement.document_opened_at ?? now };

await prisma.agreement.update({ where: { id: agreement.id }, data });
```

Validate `stage` against the two literals and `content_hash` against `/^[0-9a-f]{64}$/` before writing; return 400 otherwise.

- [ ] **Step 4: Run the test**

```bash
cd apps/backend && npx vitest run tests/agreement-read-progress.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/tenants/activate/agreement-read apps/backend/tests/agreement-read-progress.test.ts
git commit -m "feat(agreements): record the tenant's read of the agreement"
```

---

### Task 10: The PDF renders from the document model

Content only. The pdf-lib drawing code is not rewritten.

**Files:**
- Modify: `apps/backend/src/services/tenants/agreement-generation-service.ts:646-649` (the `termsList` composition)
- Test: `apps/backend/tests/agreement-pdf-parity.test.ts`

**Interfaces:**
- Consumes: `buildAgreementDocument` (Task 3), `agreementDocumentInputFromRenderData` (Task 5)
- Produces: no new exports. `generatePdfBuffer` keeps its signature.

- [ ] **Step 1: Write the failing parity test**

```ts
import { describe, expect, it } from "vitest";
import { buildAgreementDocument } from "@/src/services/agreements/agreement-document";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";
// Reuse the `renderData` fixture shape from tests/agreement-document-resolver.test.ts.

describe("PDF and reader show the same document", () => {
  it("orders clauses identically in both bands", () => {
    const doc = buildAgreementDocument(agreementDocumentInputFromRenderData(renderData, opts));
    const sections = doc.blocks.filter((b) => b.kind === "section") as any[];
    // The owner's terms lead, the owner's rules follow, the platform clauses close.
    expect(sections.map((s) => `${s.origin}:${s.band}`)).toEqual([
      "owner:terms", "owner:rules",
      "platform:terms", "platform:terms", "platform:terms", "platform:terms", "platform:terms",
    ]);
  });

  it("gives every clause a number with no gaps", () => {
    const doc = buildAgreementDocument(agreementDocumentInputFromRenderData(renderData, opts));
    const numbers = (doc.blocks.filter((b) => b.kind === "section") as any[]).map((s) => s.number);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("interpolates the same values the PDF would print", () => {
    const withToken = { ...renderData, hostelRules: { categories: [{ id: "a", title: "Fees", rules: ["Rent {{MONTHLY_RENT}}"] }] } };
    const doc = buildAgreementDocument(agreementDocumentInputFromRenderData(withToken, opts));
    const rules = (doc.blocks.filter((b) => b.kind === "section") as any[]).find((s) => s.band === "rules");
    expect(rules.clauses[0].text).toBe("Rent 8000");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-pdf-parity.test.ts
```

Expected: the ordering assertion FAILS — today the PDF composes `termsList` independently and never sees the rules band as numbered sections.

- [ ] **Step 3: Have the PDF read its clause list from the model**

In `generatePdfBuffer`, replace the independent composition at lines 646-649:

```ts
    const termsList = numberClauses([
      ...(data.termsAndConditions || DEFAULT_TERMS_AND_CONDITIONS),
      ...standardLegalClauses(legalContext),
    ]);
```

with a read from the composed document, so the renderer draws what the reader shows:

```ts
    // The clause list is decided by the composer, not here. The renderer owns
    // *how* the document is drawn; *what* it says is one shared model, which
    // is what stops the reader and the PDF drifting apart.
    const composed = buildAgreementDocument(
      agreementDocumentInputFromRenderData(data, {
        reference: agreementReference,
        versionNumber: (data as any).versionNumber ?? 1,
        status: (data as any).status ?? "SIGNED",
        verificationUrl,
      }),
    );
    const termsList = (composed.blocks.filter((b) => b.kind === "section") as any[])
      .filter((s) => s.band === "terms")
      .map((s) => ({ number: s.number, title: s.title, body: s.clauses.map((c: any) => c.text).join(" ") }));
```

Leave the `hostelRules` drawing block below it exactly as it is for now — the rules band keeps its own "HOSTEL RULES & REGULATIONS" presentation in the PDF. Unifying the two presentations is Phase 2 work and must not be smuggled in here.

- [ ] **Step 4: Run the parity test and the whole agreement suite**

```bash
cd apps/backend && npx vitest run tests/agreement-pdf-parity.test.ts
npx vitest run tests/ -t "agreement"
npm test
```

Expected: PASS, and all 15 pre-existing agreement test files still green.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/tenants/agreement-generation-service.ts apps/backend/tests/agreement-pdf-parity.test.ts
git commit -m "refactor(agreements): render the PDF's clauses from the shared model"
```

---

### Task 11: Frontend — shared types and the pure reading module

**Files:**
- Create: `apps/frontend/src/features/agreements/document/agreementDocument.ts`
- Create: `apps/frontend/src/features/agreements/document/documentReading.ts`
- Test: `apps/frontend/src/features/agreements/document/documentReading.test.ts`

**Interfaces:**
- Consumes: the `AgreementDocument` JSON shape from Tasks 3/6
- Produces:
  - `type DocBlock`, `type AgreementDocument` (mirrors of the backend types)
  - `sectionIndex(doc: AgreementDocument): Array<{ number: number; title: string; anchorId: string; severity?: string }>`
  - `readProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number` — 0..1
  - `isReadComplete(progress: number): boolean`
  - `gateState(args: { readCompleted: boolean; hasTenantSignature: boolean; hasTenantName: boolean }): { canSign: boolean; reason: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { sectionIndex, readProgress, isReadComplete, gateState } from "./documentReading";

const doc: any = {
  reference: "AGR-42",
  contentHash: "a".repeat(64),
  blocks: [
    { kind: "title", text: "HOSTEL ACCOMMODATION AGREEMENT" },
    { kind: "section", number: 1, title: "Notice Period", clauses: [], origin: "owner", band: "terms" },
    { kind: "section", number: 2, title: "Fees", clauses: [], origin: "owner", band: "rules", severity: "important" },
    { kind: "execution", text: "IN WITNESS WHEREOF" },
  ],
  meta: {},
};

describe("sectionIndex", () => {
  it("lists only section blocks, in order", () => {
    expect(sectionIndex(doc).map((s) => s.title)).toEqual(["Notice Period", "Fees"]);
  });

  it("gives each section a stable anchor id", () => {
    expect(sectionIndex(doc).map((s) => s.anchorId)).toEqual(["agreement-section-1", "agreement-section-2"]);
  });

  it("carries severity so the card can surface highlights", () => {
    expect(sectionIndex(doc)[1].severity).toBe("important");
  });
});

describe("readProgress", () => {
  it("is 0 at the top", () => {
    expect(readProgress(0, 2000, 800)).toBe(0);
  });

  it("is 1 at the bottom", () => {
    expect(readProgress(1200, 2000, 800)).toBe(1);
  });

  it("is 0.5 halfway through the scrollable distance", () => {
    expect(readProgress(600, 2000, 800)).toBeCloseTo(0.5);
  });

  it("is 1 when the document is shorter than the viewport", () => {
    // Nothing to scroll means it has been read, not that it never can be.
    expect(readProgress(0, 500, 800)).toBe(1);
  });

  it("never exceeds 1 on overscroll", () => {
    expect(readProgress(5000, 2000, 800)).toBe(1);
  });
});

describe("isReadComplete", () => {
  it("accepts a near-bottom position, because exact equality never fires on real devices", () => {
    expect(isReadComplete(0.99)).toBe(true);
  });

  it("rejects a partial read", () => {
    expect(isReadComplete(0.62)).toBe(false);
  });
});

describe("gateState", () => {
  it("blocks signing before the document has been read", () => {
    expect(gateState({ readCompleted: false, hasTenantSignature: true, hasTenantName: true }))
      .toEqual({ canSign: false, reason: "Read the full agreement first" });
  });

  it("blocks signing without a tenant signature", () => {
    expect(gateState({ readCompleted: true, hasTenantSignature: false, hasTenantName: true }))
      .toEqual({ canSign: false, reason: "Your signature is required" });
  });

  it("blocks signing without a typed name", () => {
    expect(gateState({ readCompleted: true, hasTenantSignature: true, hasTenantName: false }))
      .toEqual({ canSign: false, reason: "Type your full name to sign" });
  });

  it("allows signing once the document is read and signed", () => {
    expect(gateState({ readCompleted: true, hasTenantSignature: true, hasTenantName: true }))
      .toEqual({ canSign: true, reason: null });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/frontend && npx vitest run src/features/agreements/document/documentReading.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement both modules**

`agreementDocument.ts` mirrors the backend types from Task 3 verbatim (`DocBlock`, `SignaturePanel`, `AgreementDocument`).

```ts
// documentReading.ts
/**
 * Reading an agreement, decided here rather than in the component.
 *
 * The signing gate is the reason this is a module of its own: whether a tenant
 * may sign is a rule about evidence, not a rendering detail, and it is tested
 * without a DOM.
 */
import type { AgreementDocument } from "./agreementDocument";

/** Real scrolling never lands exactly at the bottom, so "read" is a threshold. */
const READ_THRESHOLD = 0.98;

export function sectionIndex(doc: AgreementDocument) {
  return doc.blocks
    .filter((b): b is Extract<typeof b, { kind: "section" }> => b.kind === "section")
    .map((s) => ({ number: s.number, title: s.title, anchorId: `agreement-section-${s.number}`, severity: s.severity }));
}

export function readProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const scrollable = scrollHeight - clientHeight;
  // A document shorter than the viewport has been read by being shown.
  if (scrollable <= 0) return 1;
  return Math.min(1, Math.max(0, scrollTop / scrollable));
}

export function isReadComplete(progress: number): boolean {
  return progress >= READ_THRESHOLD;
}

export function gateState(args: { readCompleted: boolean; hasTenantSignature: boolean; hasTenantName: boolean }):
  { canSign: boolean; reason: string | null } {
  if (!args.readCompleted) return { canSign: false, reason: "Read the full agreement first" };
  if (!args.hasTenantSignature) return { canSign: false, reason: "Your signature is required" };
  if (!args.hasTenantName) return { canSign: false, reason: "Type your full name to sign" };
  return { canSign: true, reason: null };
}
```

- [ ] **Step 4: Run the test**

```bash
cd apps/frontend && npx vitest run src/features/agreements/document/documentReading.test.ts
```

Expected: PASS, all 16 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/agreements/document
git commit -m "feat(agreements): pure reading and signing-gate logic"
```

---

### Task 12: Frontend — the block renderer

**Files:**
- Create: `apps/frontend/src/features/agreements/document/AgreementDocumentView.tsx`

**Interfaces:**
- Consumes: `AgreementDocument`, `sectionIndex` from Task 11
- Produces: `<AgreementDocumentView doc={AgreementDocument} />` — a thin renderer with no decisions in it.

- [ ] **Step 1: Implement the renderer**

One `switch` over `block.kind`. Requirements:

- Semantic tokens only (`text-foreground`, `bg-card`, `border-border`) so dark mode works — **not** the hardcoded `#F6F1EA` / `#221E1A` hex values the current `AgreementStep` uses.
- Each section gets `id={`agreement-section-${number}`}` to match `sectionIndex`.
- A section with `severity === 'important'` gets a visible marker.
- `origin === 'platform'` sections are rendered identically to owner sections — the tenant is reading one contract, not a contract plus an appendix.
- Prose sized for reading on a phone: `text-[13.5px] leading-[1.65]`, generous section spacing, `max-w-[68ch]` on wide screens.
- No `dangerouslySetInnerHTML` anywhere. Clause text is plain text.

- [ ] **Step 2: Verify it compiles and the architecture check passes**

```bash
cd apps/frontend && npm run check:architecture && npx tsc --noEmit
```

Expected: PASS. (The check enforces no raw `fetch`/`axios` outside `@lib/api-client` — this component does no fetching at all.)

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/features/agreements/document/AgreementDocumentView.tsx
git commit -m "feat(agreements): render the agreement document"
```

---

### Task 13: Frontend — the reader screen

**Files:**
- Create: `apps/frontend/src/features/agreements/document/agreementDocumentApi.ts`
- Create: `apps/frontend/src/platforms/tenant/onboarding/AgreementReaderPage.tsx`
- Modify: `apps/frontend/src/app/router` (add `/tenant/activate/agreement`)

**Interfaces:**
- Consumes: `AgreementDocumentView` (Task 12), `readProgress`/`isReadComplete` (Task 11), endpoints from Tasks 6 and 9
- Produces:
  - `fetchActivationAgreementDocument(token: string): Promise<AgreementDocument>`
  - `recordAgreementRead(token: string, stage: 'opened' | 'completed', contentHash: string): Promise<void>`
  - Route `/tenant/activate/agreement?token=…`

- [ ] **Step 1: Write the API wrapper**

Goes through `@lib/api-client` — raw `axios`/`fetch` here fails `check:architecture`.

```ts
import api from '@lib/api-client';
import type { AgreementDocument } from './agreementDocument';

export async function fetchActivationAgreementDocument(token: string): Promise<AgreementDocument> {
  const res = await api.get('/tenants/activate/agreement-document', { params: { token } });
  return res.data.document;
}

export async function recordAgreementRead(
  token: string, stage: 'opened' | 'completed', contentHash: string,
): Promise<void> {
  await api.post('/tenants/activate/agreement-read', { token, stage, content_hash: contentHash });
}
```

- [ ] **Step 2: Build the reader page**

- Full screen. Sticky header: back, title, and a progress bar driven by `readProgress`.
- Body: `<AgreementDocumentView />` inside the scroll container whose metrics feed `readProgress`.
- Fire `recordAgreementRead(token, 'opened', hash)` once on mount.
- When `isReadComplete(progress)` first turns true, fire `recordAgreementRead(token, 'completed', hash)` and swap the footer to a primary **"I've read it — continue to sign"** which navigates back to the step.
- Footer before completion: a muted "Scroll to the end to continue" with the percentage.
- Sticky footer uses `pb-[max(0.75rem,env(safe-area-inset-bottom))]`.

- [ ] **Step 3: Register the route**

Lazy-load it the way the tenant routes already lazy-load, keeping the `?token=` query intact on navigation in both directions.

- [ ] **Step 4: Verify**

```bash
cd apps/frontend && npm run check:architecture && npx tsc --noEmit && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/agreements/document/agreementDocumentApi.ts \
        apps/frontend/src/platforms/tenant/onboarding/AgreementReaderPage.tsx \
        apps/frontend/src/app/router
git commit -m "feat(agreements): tenant reads the real agreement before signing"
```

---

### Task 14: Rebuild the tenant agreement step

Deletes the fabricated document. This is audit issues #13, #14 and #16.

**Files:**
- Modify: `apps/frontend/src/platforms/tenant/onboarding/steps/AgreementStep.tsx`
- Modify: `apps/frontend/src/platforms/tenant/onboarding/activationTypes.ts` (add the read fields)

**Interfaces:**
- Consumes: `gateState`, `sectionIndex` (Task 11); the reader route (Task 13)
- Produces: an `AgreementStep` that renders no contract text of its own.

- [ ] **Step 1: Delete the fabricated document**

Remove the entire `<div className="mt-[15px] rounded-[13px] ...">` block: the "HOSTEL RESIDENCY AGREEMENT" header, "1. Room & Financial Summary", the hardcoded **"6. Management Rights"** and its two invented sentences, and the inline acknowledgements. Keep `TheWordCard`, `CommitmentSheet`, both signature rows and `SignatureSheet` untouched.

- [ ] **Step 2: Add the document card in its place**

- Title, hostel name, `versionNumber`.
- Honest counts from `sectionIndex(doc).length` and the clause total — never a hardcoded number.
- The `severity === 'important'` section titles as a short highlights list.
- A prominent **"Read the full agreement →"** navigating to `/tenant/activate/agreement?token=…`.
- Once read: a green "You've read this agreement" confirmation with the timestamp.

- [ ] **Step 3: Move the acknowledgements behind the read**

The five `REQUIRED_ACKS` stay exactly as they are, with the same keys — they are server-validated and back existing `tenant_policy_acceptances` rows. Render them only once the read is complete, introduced as a confirmation of the document just read rather than as a substitute for it.

- [ ] **Step 4: Gate the submit button**

Replace the ad-hoc checks in `handleSubmit` with `gateState(...)`, and show `reason` under a disabled primary button so the tenant always knows what is missing. Read `readCompleted` from `ctx.agreement.document_read_completed_at` (server truth), not local state — add that field to `activationTypes.ts` and to the backend's agreement payload.

- [ ] **Step 5: Verify and commit**

```bash
cd apps/frontend && npm run check:architecture && npx tsc --noEmit && npm test && npm run build
```

```bash
git add apps/frontend/src/platforms/tenant/onboarding/steps/AgreementStep.tsx \
        apps/frontend/src/platforms/tenant/onboarding/activationTypes.ts
git commit -m "fix(agreements): show tenants the real agreement, not a stub

The step rendered a hardcoded document containing none of the owner's
clauses -- section 1, then a jump to a fabricated 'Management Rights'.
The owner's clauses were being sent to the client and read by nothing."
```

---

### Task 15: The tenant signature becomes mandatory

The one behavioural change in Phase 1 that can block a real activation.

**Files:**
- Modify: `apps/backend/src/services/tenants/agreement-requirement.ts` (add `isGuardianSignatureRequired`)
- Modify: `apps/frontend/src/platforms/tenant/onboarding/steps/AgreementStep.tsx` (`validateSignatures`)
- Modify: `apps/backend/src/services/tenants/activation-workflow-service.ts` (the `AGREEMENT` step handler)
- Test: `apps/backend/tests/agreement-signature-requirement.test.ts`

**Interfaces:**
- Consumes: `policy.tenant_rules.guardian_signature_required` (policy JSON — no migration)
- Produces: server-side rejection of an agreement submitted without a tenant signature.

- [ ] **Step 1: Write the failing test**

```ts
it("rejects an agreement with no tenant signature", async () => {
  // → VALIDATION_ERROR, and the agreement stays unsigned
});
it("accepts a tenant signature with no guardian", async () => { /* → signed */ });
it("rejects a guardian-only signature", async () => { /* → VALIDATION_ERROR */ });
it("requires a guardian signature when the hostel policy asks for one", async () => {
  // policy.tenant_rules.guardian_signature_required = true, tenant only → VALIDATION_ERROR
});
it("leaves an already-signed guardian-only agreement valid", async () => {
  // Pre-existing rows must not be retroactively invalidated.
});
```

That last case is the important one. Assert it against an agreement row seeded as already `SIGNED` with only guardian fields populated.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-signature-requirement.test.ts
```

Expected: the first and third cases FAIL — a guardian-only submission is currently accepted.

- [ ] **Step 3: Add the policy reader next to its sibling**

`agreement-requirement.ts` already exports `isAgreementRequired`, which handles every shape the policy arrives in (bare, `tenant_rules`-wrapped, `policy`-wrapped, explicitly `null`). Add its sibling in the same file and test it the same way:

```ts
/**
 * Whether this hostel insists on a parent/guardian co-signature.
 *
 * Mirrors `isAgreementRequired`, with the opposite default: an absent flag
 * means *not* required. Requiring one is a deliberate choice a hostel makes,
 * so a hostel predating the setting must not suddenly block its tenants.
 */
export function isGuardianSignatureRequired(policy: any): boolean {
  const rules = policy?.policy?.tenant_rules ?? policy?.tenant_rules ?? policy ?? {};
  return rules?.guardian_signature_required === true;
}
```

Add cases to `tests/agreement-requirement.test.ts` covering all four policy shapes plus explicit `null`, matching the existing `isAgreementRequired` block.

- [ ] **Step 4: Enforce it server-side**

In the `AGREEMENT` step handler, before writing signatures, with `guardianRequired = isGuardianSignatureRequired(hostelPolicy)`:

```ts
// The tenant must sign. This used to accept "tenant, guardian, or both",
// which meant a tenancy could be activated with no signature from the person
// who actually lives there. Guardian is now a genuine co-signature.
//
// Applies to signatures taken from here on. Agreements already signed
// guardian-only stay valid -- this is validation on submission, not a
// re-check of stored rows.
if (!data.tenant_signature_url || !data.tenant_signature_name) {
  throw new Error("VALIDATION_ERROR: The tenant's signature is required");
}
if (guardianRequired && (!data.guardian_signature_url || !data.guardian_signature_name)) {
  throw new Error("VALIDATION_ERROR: This hostel requires a parent or guardian co-signature");
}
```

- [ ] **Step 5: Mirror it in the frontend**

In `validateSignatures`, replace "at least one of tenant or guardian" with: tenant signature and typed name always required; guardian required only when the policy flag is set. The message must match the server's.

- [ ] **Step 6: Run everything and commit**

```bash
cd apps/backend && npm test
cd ../frontend && npm test && npx tsc --noEmit
```

```bash
git add apps/backend/src/services/tenants/activation-workflow-service.ts \
        apps/backend/tests/agreement-signature-requirement.test.ts \
        apps/frontend/src/platforms/tenant/onboarding/steps/AgreementStep.tsx
git commit -m "fix(agreements): require the tenant's own signature

'Tenant, guardian, or both' allowed activation with no signature from
the person living there. Already-signed agreements are unaffected."
```

---

### Task 16: The legal footer

**BLOCKED** on the user's sign-off (spec §6.7). Do not invent contract wording.

**Files:**
- Modify: `apps/frontend/src/platforms/tenant/onboarding/steps/AgreementStep.tsx` (footer line)

- [ ] **Step 1: Confirm the wording with the user before writing it**

The line being replaced is:

> "Valid under the IT Act. Digital signatures and IP details collected during onboarding are legally binding."

The problem: a drawn PNG is an **electronic signature**, not a *digital signature* in the IT Act §3 sense (which means an asymmetric-crypto signature affixed with a Digital Signature Certificate). The current line claims a legal character the artifact does not have.

Present the user with a neutral candidate that describes what is true — an electronic record, signed electronically, with the signatory's IP and device recorded — and get explicit approval before editing the file.

- [ ] **Step 2: Apply the approved wording and commit**

```bash
git add apps/frontend/src/platforms/tenant/onboarding/steps/AgreementStep.tsx
git commit -m "fix(agreements): describe the signature accurately"
```

---

### Task 17: Documentation

Required by the repo's documentation rule — shipping without this is incomplete work, not optional follow-up.

**Files:**
- Modify: `docs/obsidian/{Features,APIs,Database,Business-Rules,Decisions,Bugs,Changelog}.md`

- [ ] **Step 1: `APIs.md`** — three new endpoints: `GET /api/tenants/activate/agreement-document`, `POST /api/tenants/activate/agreement-read`, `GET /api/agreements/[id]/document`.

- [ ] **Step 2: `Database.md`** — the three `Agreement` columns, all nullable and additive, with the migration number from Task 0.

- [ ] **Step 3: `Business-Rules.md`** — the read gate, and the tenant-signature requirement including the "already-signed guardian-only agreements stay valid" carve-out.

- [ ] **Step 4: `Decisions.md`** — three ADRs, numbered from Task 0 Step 2: the canonical document model and `contentHash`; the read-before-sign gate; the mandatory tenant signature.

- [ ] **Step 5: `Bugs.md`** — two entries, both real design gaps: the single-brace token defect, and the dropped-clauses regression (with the note that `src/portal` rendered them correctly and `platforms/tenant` lost it).

- [ ] **Step 6: `Features.md` and `Changelog.md`** — the tenant reader, with wiki links to at least one related note each so the graph stays connected.

- [ ] **Step 7: Commit**

```bash
git add docs/obsidian
git commit -m "docs(obsidian): agreement document model, read gate, signature rule"
```

---

## Phase 1 exit criteria

- [ ] `cd apps/backend && npm test` — green, including all 15 pre-existing agreement test files
- [ ] `cd apps/backend && npm run check:invariants` — green
- [ ] `cd apps/frontend && npm test && npm run build` — green (build runs `check:architecture` and the branding check)
- [ ] A tenant cannot reach a signable state without `document_read_completed_at` set server-side
- [ ] A tenant cannot activate without their own signature
- [ ] The clauses an owner published appear, interpolated, in what the tenant reads
- [ ] Task 16 resolved with the user, not guessed

## Deferred to later phases

**Phase 2** — owner workspace rebuild (5 screens → 1), the owner draft-preview endpoint `POST /api/owner/hostels/[id]/agreement-template/document` (spec §3.6 — not needed until the owner Read segment exists), wiring the long-dead PDF preview endpoint as "Download a sample PDF", publish review with diff, dead-code removal (`deriveAgreementSections`, `/agreements/variables`), the `insertToken` fix, and the decision on whether owners may edit the `terms` band.
**Phase 3** — import rebuild, existing-tenant reader at `/tenant/agreement`, unifying the PDF's two clause presentations.
