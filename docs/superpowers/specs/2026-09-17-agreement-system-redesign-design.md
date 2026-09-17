# Agreement System Redesign — Design

**Date:** 2026-09-17
**Status:** Approved, ready for planning
**Scope:** The tenancy agreement end to end — how an owner drafts it, how a tenant reads and signs it, and how the PDF is produced. Covers tenant onboarding, the owner drafting surfaces, and a reading view for already-activated tenants. **Renewals are explicitly out of scope** for this design.

---

## 1. Why

**The document an owner drafts and the document a tenant signs are two different artifacts, and neither party ever sees the third one — the PDF — until after it is binding.**

That is not a UX complaint. It is three separate systems that were built at different times and never joined up:

- The owner edits `AgreementTemplate.rules_content` in a line editor.
- The tenant is shown a **hardcoded stub** that contains none of it.
- The PDF is composed independently, server-side, from a snapshot — *after* the signature is captured.

Everything below follows from closing that gap.

### 1.1 Audit — owner side

| # | Issue | Evidence |
|---|---|---|
| 1 | **Variable tokens do not work.** The editor's chip buttons insert `{TENANT_NAME}` (single braces). The backend only substitutes `{{TENANT_NAME}}`. Every variable an owner inserts prints **literally** in the signed PDF. | `config/agreementDraft.ts:155-163` vs `src/utils/default-rules.ts:154` |
| 2 | **Three modules, two token formats.** `agreementDraft.ts` uses single braces; `agreements.ts` uses double; the backend uses double. | `config/agreements.ts:95` |
| 3 | **Nobody can see the real document before it is issued.** A working endpoint renders the actual PDF with sample data, and an API wrapper exists for it. **Zero callers.** | `app/api/owner/hostels/[id]/agreement-template/preview/route.ts`; `features/owners/api/index.js:221` |
| 4 | **The editor's "Preview" is a different document.** Hand-rolled HTML that omits the preamble, `standardLegalClauses`, the execution statement, the platform attestation and the owner's signature block — all of which the real PDF adds. | `MoreConfigAgreementEditorPage.tsx` preview branch |
| 5 | **Drafting is five taps deep**, across two screens with different save semantics (Clauses: instant save + toast; Editor: 1.2s debounce autosave) that write the same `rules_content`. | `MoreConfigAgreementClausesPage.tsx`, `MoreConfigAgreementEditorPage.tsx` |
| 6 | **The variable picker reaches through the DOM.** `closest('div')?.parentElement?.querySelector('textarea')` then assigns `el.value` directly — React state and the DOM diverge until blur. | `MoreConfigAgreementEditorPage.tsx` |
| 7 | **Line edits commit on `onBlur` only**, so tapping straight from one line to another can drop the edit. | same |
| 8 | **Sticky bar is pinned at `bottom-[68px]`**, assuming the mobile tab bar. On desktop it floats mid-screen. The codebase convention everywhere else is `env(safe-area-inset-bottom)`. | same |
| 9 | **Publishing is blind.** One tap, no diff against the live version, no count of who it affects. "Version history" is just the template list. | same |
| 10 | **Import is a raw textarea behind a `window.confirm`** that replaces the entire document with no review step. | same |
| 11 | **Dead code with live tests.** `deriveAgreementSections` is unused in app code but still tested, and routes to `/agreements/variables`, which was never registered. | `config/agreements.ts:160+`, `OwnerRoutes.tsx` |
| 12 | **No "New template" action** — the Templates screen says so outright. | `MoreConfigAgreementTemplatesPage.tsx` |

### 1.2 Audit — tenant side

| # | Issue | Evidence |
|---|---|---|
| 13 | **The tenant never sees the owner's clauses. At all.** `ctx.rules.content.categories` is sent to the client and has **zero consumers** in `platforms/tenant`. | `activationTypes.ts:61-65`; no reader anywhere in `platforms/tenant` |
| 14 | **What is shown instead is fabricated.** Section "1. Room & Financial Summary", then a jump to a hardcoded "6. Management Rights" with two fixed sentences, then "7. Acknowledgements". Sections 2–5 do not exist. | `AgreementStep.tsx` |
| 15 | **This is a regression, not an unbuilt feature.** The frozen legacy portal rendered the real categories. | `portal/pages/ActivateAccountPage.tsx:834` |
| 16 | **Sign first, document second.** The PDF is generated *after* signing. The tenant commits to a document that does not yet exist. | `activation-workflow-service.ts:1158` |
| 17 | **The payload is un-interpolated anyway.** `rulePayload(ruleVersion)` is called without `variables`, so even if the UI rendered it, tenants would read raw `{{MONTHLY_RENT}}`. | `activation-workflow-service.ts:752` |
| 18 | **The five acknowledgements are generic**, unrelated to the owner's clauses, yet recorded as consent stamped with IP and user agent. | `AgreementStep.tsx:43-49`; `tenant_policy_acceptances` |
| 19 | **A guardian-only signature satisfies the agreement.** A tenant can be activated having never signed. | `AgreementStep.tsx` `validateSignatures()` |
| 20 | **The legal footer overclaims.** "Valid under the IT Act. Digital signatures ... are legally binding." A drawn PNG is an *electronic* signature, not a digital signature in the IT Act §3 sense. | `AgreementStep.tsx` |

### 1.3 What is already good, and is kept

- `lib/pdf/agreement-content.ts` is **already a pure module** — no pdf-lib, no I/O — holding the preamble, standard legal clauses, execution statement, page footer and attestation, with its own tests. It is the seam this whole design hangs on.
- `SignatureSheet` already supports **draw on screen or upload a photo**, with client-side background removal (ADR-140). Untouched by this work.
- `RuleVersion` is genuinely synced from the published `AgreementTemplate` (`getActiveTemplateAndSyncRuleVersion`). The owner's content *does* reach the activation payload. The data is correct; only the UI discards it.
- The `Agreement` model already snapshots contract terms (`rules_snapshot`, `content_snapshot`, `contract_*`). Immutability of signed agreements is already the established pattern.

---

## 2. Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Canonical rendering | **HTML canonical, PDF derived** | Mobile-first reading; one content source |
| Owner control | **Sections + clauses, guarded boilerplate** | Owner owns their terms; the legal frame stays platform-owned and structurally unremovable |
| Read gate | **Must open and reach the end**, recorded server-side | Real consent evidence |
| Scope | Onboarding sign flow, owner drafting, existing-tenant reader | Renewals deliberately excluded |
| Signature rule | **Tenant signature always required**; guardian optional, owner-enforceable | Closes the "nobody who lives there signed" hole |
| Template granularity | **One published document per hostel** | Per-tenant variation already happens via auto-filled values |
| Import | **Rebuild paste-and-parse as a reviewable flow** | Owners have existing Word/paper agreements |

---

## 3. Architecture — the document model

### 3.1 The composer

A new pure module, `apps/backend/src/services/agreements/agreement-document.ts` — **no Prisma, no pdf-lib, no I/O**. It takes resolved inputs and returns an ordered block list.

```ts
type DocBlock =
  | { kind: 'title';       text: string; subtitle?: string }
  | { kind: 'preamble';    text: string }
  | { kind: 'facts';       rows: Array<{ label: string; value: string }> }
  | { kind: 'section';     number: number; title: string;
                           clauses: Array<{ number: string; text: string }>;
                           origin: 'owner' | 'platform';
                           band: 'terms' | 'rules';
                           severity?: 'important' | 'standard' }
  | { kind: 'execution';   text: string }
  | { kind: 'signatures';  panels: SignaturePanel[] }
  | { kind: 'attestation'; text: string; verificationUrl: string | null };

type AgreementDocument = {
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
```

### 3.2 Block order is fixed by code, not data

```
preamble → facts → owner sections → platform legal clauses
         → execution → signatures → attestation
```

Owner content can only ever occupy the `origin: 'owner'` band. **There is no code path by which an owner can delete the execution block or the attestation.** This is how "guarded boilerplate" is enforced — structurally, not by validation that can be bypassed.

Clause numbering runs continuously across the owner band and the platform band, so the document reads as one instrument rather than two stapled together.

**There are two content bands, not one**, which is why `section` carries a
`band` discriminator. The PDF renders `terms_and_conditions` as numbered legal
clauses *and* `rules_content.categories` as a separate "HOSTEL RULES &
REGULATIONS" section incorporated by reference. **The owner's editor only ever
touched the second**, so an owner cannot currently edit the numbered clauses of
their own contract at all. Whether they should be able to is a Phase 2
decision; Phase 1 only has to stop the two bands being composed by two
different pieces of code.

### 3.3 Boilerplate provider

`lib/pdf/agreement-content.ts` moves to `src/services/agreements/agreement-boilerplate.ts`, keeping its tests and its exports (`preamble`, `standardLegalClauses`, `executionStatement`, `platformAttestation`, `pageFooter`, `numberClauses`, `clauseBody`, `placeFromAddress`, `rupees`). It stops being the PDF renderer's private helper and becomes the composer's input. The PDF renderer imports it transitively.

Its existing header comment — including the deliberate "Stayo is not a party to this contract, no watermark, one footer line" stance — carries over unchanged. That stance is correct and this design does not revisit it.

### 3.4 Interpolation, and the token fix

Interpolation happens **once, in the composer**, before any block is produced.

`interpolateText` is widened to accept **both** `{{VAR}}` and `{VAR}`:

```ts
/\{\{\s*([A-Z0-9_]+)\s*\}\}|\{\s*([A-Z0-9_]+)\s*\}/g
```

Written as two explicit alternatives rather than optional braces (`\{\{?…\}\}?`), which would also match mismatched pairs such as `{VAR}}` and silently "fix" malformed input instead of leaving it visible to the owner.

This fixes issue #1 with **no data migration** — templates already saved with single braces start working immediately. The editor writes `{{VAR}}` only from now on, so the two formats converge naturally.

Unknown-token behaviour is unchanged for final renders (`____`), because changing it would alter how already-signed documents re-render. What changes is that **the owner can no longer publish a template containing an unknown token** (§5.4).

### 3.5 `contentHash` — the fidelity guarantee

`contentHash` is a SHA-256 over the normalised block list (text content and order only; no timestamps, no signature URLs). It is stamped onto `Agreement.document_content_hash` at sign time.

The HTML the tenant read and the PDF generated afterwards both derive from the same `AgreementDocument`. If they ever stop doing so, the hash comparison fails loudly instead of silently shipping a different document. **This is the property that makes the HTML-canonical approach safe** — the guarantee is checkable rather than aspirational.

### 3.6 Consumers

| Surface | Endpoint | Inputs |
|---|---|---|
| Tenant reading **during onboarding** | `GET /api/tenants/activate/agreement-document?token=` | Real agreement, real facts, own `rules_snapshot` |
| Signed-agreement view (logged in) | `GET /api/agreements/[id]/document` | Same, session-authorised |
| Owner draft preview | `POST /api/owner/hostels/[id]/agreement-template/document` | Draft `rules_content` + sample values |
| PDF | *(no new endpoint)* | Renderer consumes `AgreementDocument` for its content |

**Why two read endpoints and not one.** Onboarding happens *before* the tenant
has an account: `/tenants/activate*` routes resolve their subject with
`activationSubjectFromRequest`, not `getSession`. A single session-guarded
endpoint could not serve the screen this whole design exists for. Note also
that the subject is a discriminated union — `{ ok, mode: 'token', token }`,
`{ ok, mode: 'session', tenantId }` or `{ ok: false }` — so token mode must go
through `tenantInvitationLifecycleService.resolveByToken` to reach a tenant.

The existing PDF preview endpoint stays and is **finally wired up** — as "Download a sample PDF", not as the primary preview.

### 3.7 Frontend rendering

New feature directory `apps/frontend/src/features/agreements/document/`:

- `AgreementDocumentView.tsx` — a thin block renderer. No decisions.
- `documentReading.ts` — **pure**: section indexing, read-progress computation, gate state, scroll-to-section targets.
- `agreementDocument.ts` — shared `AgreementDocument` types.

All decisions live in the `.ts` modules and are unit-tested directly, per the repo's node-environment, `.test.ts`-only frontend test rule. No `.test.tsx`, no component rendering.

---

## 4. Immutability of signed agreements

**A signed agreement is never re-composed against the current template.** It renders from its own `rules_snapshot` and `content_snapshot`, which is what was actually signed. The archived PDF remains the artifact of record.

This matters for the existing-tenant reader (§6.4): an owner publishing v4 must not retroactively change what a tenant who signed v2 sees. The composer takes a snapshot as input and has no access to "the current template" — it cannot make this mistake.

---

## 5. Owner drafting, rebuilt mobile-first

### 5.1 Five screens collapse into one workspace

`/owner/more/configuration/agreements` stops being a menu and becomes the document workspace, with two segments:

- **Write** — sections and clauses, with a version strip at the top.
- **Read** — the real composed document, from the same endpoint the tenant hits.

| Screen | Fate |
|---|---|
| `MoreConfigAgreementsPage` | Becomes the workspace |
| `MoreConfigAgreementEditorPage` | Becomes the Write segment |
| `MoreConfigAgreementTemplatePage` | Becomes the Read segment |
| `MoreConfigAgreementTemplatesPage` | Collapses into the version strip |
| `MoreConfigAgreementClausesPage` | **Deleted** — its only unique job (toggling a section in/out) already exists in Write |
| `MoreConfigAgreementRequirementPage` | Kept as-is (a genuine separate setting) |
| `MoreConfigAgreementSignaturePage` | Kept as-is |

`deriveAgreementSections` and its tests are deleted, along with the dead `/agreements/variables` reference.

### 5.2 Editing on a phone

- The seven-pill toolbar per section is removed.
- A line is a tap-to-edit autosize textarea committing **`onChange`**, not `onBlur` (fixes #7).
- Per-line actions collapse to a single `⋯` menu (move up/down, duplicate, delete).
- Section actions collapse to a section `⋯` menu (rename, mark important, leave out, reset wording, delete).
- Reordering gets a drag handle, with the arrow buttons kept as the accessible fallback.

### 5.3 Variable insertion

The DOM-reaching hack is replaced by a pure function against a proper ref:

```ts
insertToken(value: string, selectionStart: number, token: string):
  { value: string; caret: number }
```

Controlled state throughout. Emits `{{VAR}}`. Unit-tested.

### 5.4 Publishing becomes a review

A sheet, not a button:

- **Diff against the live version** — sections added / removed / reworded, from a pure `diffAgreementDocument()`.
- **Blast radius** — how many future tenants will sign this.
- **Hard block** on unknown tokens.
- **Warning** if the owner's signature stamp is not set.

### 5.5 Import

A dedicated route, `/owner/more/configuration/agreements/import`:

1. Paste text.
2. Parse into sections (reuses and hardens `parsePastedAgreement`).
3. **Review** — what was detected, with controls to promote a line to a heading, demote a heading, merge and split.
4. Commit as a draft.

Replaces the raw textarea behind `window.confirm` that silently replaced the whole document. File upload (PDF/DOCX) is explicitly **not** in this design.

### 5.6 Layout

- Sticky bar uses `pb-[max(0.75rem,env(safe-area-inset-bottom))]`, matching the rest of the codebase. `bottom-[68px]` is removed.
- At `lg:` the workspace is two-column — sections left, live document right. Mobile-first, not mobile-only. The laptop gets a real layout rather than a stretched phone screen.

---

## 6. Tenant read and sign

### 6.1 The stub is deleted

The fabricated "1. Room & Financial Summary" / "6. Management Rights" / "7. Acknowledgements" markup is removed from `AgreementStep.tsx` entirely.

### 6.2 The step becomes three things

1. **A document card** — title, hostel, the term (`TheWordCard` is kept), an honest count ("7 sections · 34 clauses"), and the owner's `severity: important` sections surfaced as a highlights list.
2. **"Read the full agreement →"** opens a dedicated full-screen route, `/tenant/activate/agreement`, rendering `AgreementDocumentView` from `GET /api/agreements/[id]/document`. Sticky progress bar, section jump, no modal, no nested scroll trap.
3. **Return and sign.** Reaching the end swaps the reader's footer to "I've read it — continue to sign", returning to the step. `SignatureSheet` is untouched — draw on screen or upload a photo, exactly as today.

### 6.3 The read gate

`POST /api/agreements/[id]/read-progress` records `document_opened_at` and `document_read_completed_at`.

The sign action is disabled until read-completion exists **server-side**, so a page reload does not hand out a free pass and the evidence survives the session.

### 6.4 Existing tenants

The same reader at `/tenant/agreement`, rendered from the tenant's own immutable `rules_snapshot` per §4.

### 6.5 The five acknowledgements — kept, with changed meaning

The canonical five keys are **kept**, not derived from the owner's clauses. They are server-validated and already back `tenant_policy_acceptances` rows in production; re-deriving them per hostel would make every historical consent record incomparable.

What changes is their role. Today they *substitute* for a document the tenant never saw. After this they sit behind a proven read of the real document, so they are a confirmation rather than a stand-in. That resolves issue #18 without breaking the server contract.

### 6.6 Tenant signature becomes mandatory

- The tenant **must** sign.
- Guardian becomes a true optional co-signature.
- A new `policy.tenant_rules.guardian_signature_required` flag lets an owner enforce it. Stored in the hostel policy JSON exactly like `agreement_required` — **no migration**.
- Validation changes on **both** the frontend (`validateSignatures`) and the backend.

**Agreements already signed guardian-only stay valid.** The rule applies to signatures taken after deploy. Retroactively invalidating live tenancies is not acceptable.

### 6.7 The legal footer — open item

"Digital signatures ... are legally binding" is replaced with accurate wording about *electronic* signatures and electronic records.

**This wording requires the user's explicit sign-off before it ships.** It is contract copy that touches the IT Act, and it is not a call to make unilaterally. It belongs alongside the existing approved legal decisions. Implementation may proceed with placeholder-neutral wording, but Phase 1 does not land without this resolved.

---

## 7. Schema

Three nullable, additive columns on `Agreement`:

```prisma
document_content_hash       String?
document_opened_at          DateTime? @db.Timestamptz(6)
document_read_completed_at  DateTime? @db.Timestamptz(6)
```

Nothing else. The guardian flag is policy JSON. The token fix needs no backfill.

### 7.1 Two cautions

- **Adding fields to `schema.prisma` has taken production down in this repo before.** The deploy-before-migrate rule applies: Prisma client ships first, migration second.
- **The migration number cannot be chosen from the current checkout.** `migrations/` tops out at `082`, but `083` is recorded as applied on prod, and this working tree is well behind `origin/main`. The same applies to the ADR number — the last known is ADR-213, and ADR numbers have collided in this repo before. **Both are chosen after pulling, not now.**

---

## 8. Verification

### 8.1 Backend

- Composer block ordering, and the **guarded band** — owner content cannot displace execution or attestation.
- Clause numbering continuity across the owner and platform bands.
- Both token formats interpolate; unknown tokens behave as specified.
- `contentHash` stability — same input, same hash; reordered content, different hash.
- **Parity test**: the PDF path and the document path produce identical clause text and order.
- Read-gate route tests; guardian/tenant signature rule tests.
- **The 15 existing agreement test files must stay green** (`apps/backend/tests/*agreement*.test.ts`). That is the regression net.

### 8.2 Frontend

Node-only `.test.ts`: `documentReading.ts`, `insertToken`, `diffAgreementDocument`, the import parser. No `.test.tsx`, no component rendering.

### 8.3 Checks

- `npm run check:architecture` (frontend)
- `npm run check:invariants` (backend)
- `npm test` on the backend — **not `test:pure`**.

---

## 9. Phasing

| Phase | Content | Rationale |
|---|---|---|
| **1** | Composer, document endpoints, PDF refactor, tenant read/sign, read gate, mandatory tenant signature, token fix | Fixes the actual harm — tenants signing a document they have never seen |
| **2** | Owner workspace rebuild, publish review, dead code removal | Pure UX; depends on Phase 1's endpoint, nothing depends on it |
| **3** | Import rebuild, existing-tenant reader | Adoption and polish; safe to slip |

The mandatory-tenant-signature rule ships in **Phase 1**. It is the one change that can block a real activation, so it lands early and watched rather than buried in a large Phase 2 diff.

---

## 10. Documentation

Per the repository documentation rule, in the same change:

| File | Update |
|---|---|
| `docs/obsidian/Features.md` | The rebuilt agreement workspace and tenant reader |
| `docs/obsidian/APIs.md` | Two new endpoints; the preview endpoint finally wired |
| `docs/obsidian/Database.md` | Three new `Agreement` columns |
| `docs/obsidian/Business-Rules.md` | Mandatory tenant signature; the read gate |
| `docs/obsidian/Decisions.md` | ADRs: canonical document model; read gate; signature rule |
| `docs/obsidian/Bugs.md` | The token defect (#1) and the dropped-clauses regression (#13) — both real design gaps |
| `docs/obsidian/Changelog.md` | One entry per phase |

---

## 11. Branching

Off `dev`, after pulling `main`. **Never onto `main` directly.**

Note: this spec is committed from `feat/clerk-auth-migration` with an unrelated dirty tree. The implementation branch is cut fresh from `dev`, and this file moved across.

---

## 12. Open items

| Item | Blocks | Owner |
|---|---|---|
| Legal footer wording (§6.7) | Phase 1 landing, not Phase 1 starting | User |
| ~~Migration number~~ | — | **Resolved: `085`** |
| ~~ADR numbers~~ | — | **Resolved: `214`, `215`, `216`** |

**How those numbers were chosen (2026-09-17).** They are deliberately *not* the
next numbers after `dev`'s highest. `dev` tops out at migration `083` and
ADR-209, but `main` already carries migration `084_lead_source_tracking.sql`
and ADR-210 through ADR-213. Numbering from `dev` alone would have produced a
duplicate migration `084` and four duplicate ADRs — the exact collision this
repository has hit before. **Both sequences must be checked against `main` and
`dev`, and the number taken above the higher of the two.**
