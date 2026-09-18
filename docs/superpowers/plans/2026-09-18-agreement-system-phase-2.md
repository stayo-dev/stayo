# Agreement System Redesign — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an owner one place to write their agreement, on a phone, seeing the real document — and let them set the commercial terms that are currently frozen across every hostel on Stayo.

**Architecture:** The owner's drafting surfaces collapse from five screens into one Write/Read workspace that reads the **same composed document** Phase 1 built. Nothing new is invented on the read side: the workspace previews through a new owner-facing endpoint that returns the same `AgreementDocument` the tenant reads and the PDF is made from.

**Tech Stack:** Vite + React 19, TanStack Query, Tailwind with semantic tokens, vitest node-environment `.test.ts` only; Next.js 14 App Router + Prisma on the backend.

**Spec:** `docs/superpowers/specs/2026-09-17-agreement-system-redesign-design.md` (§5, plus the Phase 2 deferrals in §9)

**Depends on:** Phase 1, merged or on the same branch. `buildAgreementDocument`, `agreementDocumentInputFromRenderData`, `AgreementDocumentView`, `sectionIndex`/`clauseCount` all exist and are used as-is.

## Global Constraints

- **Frontend tests are node-environment only.** `src/**/*.test.ts`, never `.test.tsx`. No jsdom, no component rendering. Decision logic goes in pure `.ts`; components stay thin renderers.
- **Run `npm test` on the backend, not `npm run test:pure`.**
- **The test database is gone.** `DATABASE_URL_TEST` points at `qsjrazcbtpmubclkevwi`, which no longer resolves, so ~322 backend tests fail on connection **on clean `dev` too**. Judge backend work by *no new failures* plus the suites you touched. Route tests are unaffected — this repo mocks Prisma in them.
- **A fresh worktree needs `.env.test` and `apps/frontend/.env` copied in**, or backend tests hard-fail on `DATABASE_URL_TEST` and two `src/app/nav` frontend tests fail on `VITE_SUPABASE_*`.
- **Migration 085 is already applied to production.** Phase 2 adds **no** schema change. If that changes, migrate **before** deploying the client — `Agreement` has 17 reads with no explicit `select`.
- **ADR numbers: check every local branch, not just `main` and `dev`.** Phase 1 took 214–217 and had to renumber to 216–219 because unpushed `fix/unpublish-removes-listing` held 214–215. Next free is *probably* 220; verify in Task 0.
- **`src/portal` is frozen.** New tenant code goes in `src/platforms/tenant` or `src/domains`. Enforced by `check:architecture`.
- **No raw `fetch`/`axios`** outside `@lib/api-client`. Same check.
- **Semantic tokens only** (`text-foreground`, `bg-card`, …). No hardcoded hex — that is what made the old tenant step unreadable in dark mode.
- **Sticky bars use `pb-[max(0.75rem,env(safe-area-inset-bottom))]`**, never `bottom-[68px]`.
- **Branch off `dev`, after pulling. Never commit to `main`.**

## Decisions taken for this phase

| Decision | Choice |
|---|---|
| The `terms` band | **Editable body, fixed headings.** Owner rewrites the text of the five canonical terms; cannot delete, rename, reorder or add. |
| Scope | **Full workspace rebuild in one landing.** |
| Template granularity | Unchanged from the spec: one published document per hostel. No "New template" action. |

## The three bands, and who owns what

This is the mental model every task below assumes.

| Band | Source | Phase 2 |
|---|---|---|
| `owner:terms` | `rules_content.terms_and_conditions`, defaulting to `DEFAULT_TERMS_AND_CONDITIONS` | **Body becomes editable.** Five fixed ids: `residential_use`, `rent_payment`, `security_deposit`, `notice_period`, `hostel_rules_compliance` — confirm the exact ids in Task 1 Step 1. |
| `owner:rules` | `rules_content.categories` | Already editable. Gains the UX fixes. |
| `platform:terms` | `standardLegalClauses()` | Stays uneditable and unreachable from input. Not touched. |

## File structure

**Created**
- `apps/backend/src/services/agreements/agreement-terms.ts` — canonical term list + `normalizeAgreementTerms()` (pure)
- `apps/backend/app/api/owner/hostels/[id]/agreement-template/document/route.ts` — owner draft preview as `AgreementDocument`
- `apps/frontend/src/features/owner-more/agreement/agreementWorkspace.ts` — pure: which segment, what the header says, publish readiness
- `apps/frontend/src/features/owner-more/agreement/agreementDiff.ts` — pure: `diffAgreementDocument()`
- `apps/frontend/src/features/owner-more/agreement/ownerAgreementApi.ts` — API wrappers
- `apps/frontend/src/features/owner-more/agreement/AgreementWorkspacePage.tsx` — the one screen
- `apps/frontend/src/features/owner-more/agreement/WriteSegment.tsx`, `ReadSegment.tsx`, `PublishReviewSheet.tsx`, `SectionRow.tsx`

**Modified**
- `apps/backend/app/api/owner/hostels/[id]/agreement-template/route.ts` — enforce the canonical terms
- `apps/frontend/src/features/owner-more/config/agreementDraft.ts` — `insertToken()`, terms-band operations
- `apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx` — one route replaces four
- `apps/frontend/src/features/owner-more/config/agreementSections.ts` — row list shrinks

**Deleted**
- `MoreConfigAgreementClausesPage.tsx`, `MoreConfigAgreementTemplatePage.tsx`, `MoreConfigAgreementTemplatesPage.tsx`, `MoreConfigAgreementEditorPage.tsx`
- `config/agreements.ts`'s `deriveAgreementSections` + its tests (dead; routes to `/agreements/variables`, never a route)

**Kept unchanged**
- `MoreConfigAgreementRequirementPage.tsx`, `MoreConfigAgreementSignaturePage.tsx` — genuinely separate settings

---

### Task 0: Branch and confirm numbering

- [ ] **Step 1: Branch**

```bash
git fetch origin
git worktree add ../stayo-agreements-p2 -b feat/agreement-owner-workspace origin/dev
# or continue on feat/agreement-document-model if Phase 1 is unmerged
```

- [ ] **Step 2: Find the real next ADR number — every branch, not just two**

```fish
for b in (git branch --format='%(refname:short)')
  git show $b:docs/obsidian/Decisions.md 2>/dev/null | grep -oE '^### ADR-[0-9]+'
end | sort -u | tail -5
```

Record the result at the top of this plan. Phase 1 was renumbered for exactly this reason.

- [ ] **Step 3: Copy the env files into the worktree**

```bash
cp /home/sp/Desktop/stayo/.env.test ../stayo-agreements-p2/.env.test
cp /home/sp/Desktop/stayo/apps/frontend/.env ../stayo-agreements-p2/apps/frontend/.env
```

---

### Task 1: The canonical terms, enforced server-side

"Fixed headings" has to be a server rule. The route currently validates `id` and `content` and nothing else, so a client could rename, drop or invent terms.

**Files:**
- Create: `apps/backend/src/services/agreements/agreement-terms.ts`
- Modify: `apps/backend/app/api/owner/hostels/[id]/agreement-template/route.ts`
- Test: `apps/backend/tests/agreement-terms.test.ts`

**Interfaces:**
- Produces: `CANONICAL_TERMS`, `normalizeAgreementTerms(submitted: unknown): Array<{id,title,content}>`

- [ ] **Step 1: Confirm the real ids before writing anything**

```bash
cd apps/backend && python3 -c "
import re
s=open('src/utils/default-rules.ts').read()
m=re.search(r'export const DEFAULT_TERMS_AND_CONDITIONS = \[(.*?)\n\];', s, re.S)
for i,t in re.findall(r'id:\s*\"([^\"]+)\".*?title:\s*\"([^\"]+)\"', m.group(1), re.S): print(i,'|',t)
"
```

Use whatever this prints. Do not trust the ids quoted in this plan.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { CANONICAL_TERMS, normalizeAgreementTerms } from "@/src/services/agreements/agreement-terms";
import { DEFAULT_TERMS_AND_CONDITIONS } from "@/src/utils/default-rules";

const ids = () => CANONICAL_TERMS.map((t) => t.id);

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
    // Fixed headings are a server rule, not a UI convention.
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
    const def = DEFAULT_TERMS_AND_CONDITIONS.find((t: any) => t.id === "notice_period")!;
    expect(out.find((t) => t.id === "notice_period")!.content).toBe(def.content);
  });

  it("always returns them in canonical order, whatever order they arrived in", () => {
    const shuffled = [...CANONICAL_TERMS].reverse().map((t) => ({ id: t.id, content: t.content }));
    expect(normalizeAgreementTerms(shuffled).map((t) => t.id)).toEqual(ids());
  });

  it("falls back to the default wording when the owner blanks a term", () => {
    const out = normalizeAgreementTerms([{ id: "notice_period", content: "   " }]);
    const def = DEFAULT_TERMS_AND_CONDITIONS.find((t: any) => t.id === "notice_period")!;
    expect(out.find((t) => t.id === "notice_period")!.content).toBe(def.content);
  });

  it("tolerates junk without throwing", () => {
    expect(normalizeAgreementTerms("nonsense" as any).map((t) => t.id)).toEqual(ids());
    expect(normalizeAgreementTerms([null, 42, { id: 7 }] as any).map((t) => t.id)).toEqual(ids());
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-terms.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// apps/backend/src/services/agreements/agreement-terms.ts
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
 */
import { DEFAULT_TERMS_AND_CONDITIONS } from "../../utils/default-rules";

export type AgreementTerm = { id: string; title: string; content: string };

export const CANONICAL_TERMS: AgreementTerm[] = (DEFAULT_TERMS_AND_CONDITIONS as AgreementTerm[]).map(
  (t) => ({ id: t.id, title: t.title, content: t.content }),
);

export function normalizeAgreementTerms(submitted: unknown): AgreementTerm[] {
  const byId = new Map<string, string>();
  if (Array.isArray(submitted)) {
    for (const raw of submitted) {
      if (!raw || typeof raw !== "object") continue;
      const id = typeof (raw as any).id === "string" ? (raw as any).id.trim() : "";
      const content = typeof (raw as any).content === "string" ? (raw as any).content.trim() : "";
      if (id && content) byId.set(id, content);
    }
  }

  // Canonical order, canonical titles, owner content where there is any.
  // A blank or missing term falls back to Stayo's wording rather than
  // shipping an agreement with a hole in it.
  return CANONICAL_TERMS.map((term) => ({
    id: term.id,
    title: term.title,
    content: byId.get(term.id) || term.content,
  }));
}
```

- [ ] **Step 5: Enforce it on the save route**

In `agreement-template/route.ts`, replace the hand-rolled `terms_and_conditions` validation loop (the block starting `// Validate terms_and_conditions (optional — backward compat)`) with normalization, so a bad payload is corrected rather than rejected:

```ts
    // Fixed headings are enforced here, not in the client: `normalizeAgreementTerms`
    // returns the canonical five in canonical order with the owner's wording,
    // so a renamed, invented, reordered or omitted term cannot be persisted.
    rules_content.terms_and_conditions = normalizeAgreementTerms(rules_content.terms_and_conditions);
```

- [ ] **Step 6: Run the tests**

```bash
cd apps/backend && npx vitest run tests/agreement-terms.test.ts tests/agreement-template-validation.test.ts
```

Expected: PASS. If `agreement-template-validation` asserted the old rejection behaviour, update it — normalizing is the new contract, and say so in the test name.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/agreements/agreement-terms.ts apps/backend/tests/agreement-terms.test.ts "apps/backend/app/api/owner/hostels/[id]/agreement-template/route.ts"
git commit -m "feat(agreements): owners can write their own commercial terms

The five terms including notice period and security deposit were frozen
at Stayo's defaults for every hostel. Owners now write the body; the
headings stay fixed so no agreement ships without a notice period."
```

---

### Task 2: The owner draft-preview endpoint

The workspace's Read segment must show the *real* document, not a second approximation. That was the original sin on the tenant side.

**Files:**
- Create: `apps/backend/app/api/owner/hostels/[id]/agreement-template/document/route.ts`
- Test: `apps/backend/tests/agreement-owner-preview-endpoint.test.ts`

**Interfaces:**
- Consumes: `buildAgreementDocument`, `CANONICAL_TERMS`/`normalizeAgreementTerms`
- Produces: `POST /api/owner/hostels/[id]/agreement-template/document` → `{ document: AgreementDocument }`

- [ ] **Step 1: Write the failing test**

Use the mocked-Prisma harness from `apps/backend/tests/activate-documents-route.test.ts` (`vi.hoisted` + `vi.mock`; route tests here never touch a database). Mock `@/lib/auth`'s `getSession` and `@/lib/db`.

```ts
it("refuses a non-owner", async () => { /* session role TENANT -> 403 */ });
it("refuses an owner who does not own the hostel", async () => {
  // hostels.findFirst scoped by owner_id returns null -> 404, and no document
});
it("composes the draft the owner sent, not what is published", async () => {
  // body.rules_content categories -> appear in the returned blocks
});
it("uses sample values so the preview reads like a real agreement", async () => {
  // facts rows are populated; no raw {{TOKEN}} survives in any clause text
});
it("includes the platform band, so the owner sees the whole document", async () => {
  // blocks contain origin 'platform' sections plus execution and attestation
});
it("normalizes the terms band before composing", async () => {
  // a renamed term in the body comes back with its canonical title
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/backend && npx vitest run tests/agreement-owner-preview-endpoint.test.ts
```

Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

Mirror the existing `agreement-template/preview/route.ts` for auth and sample data — it already builds a `mockData` block with a sample tenant, rent and room, and it is the shape the PDF preview uses. Scope the hostel lookup by `owner_id: session.sub` exactly as that route does; **never** fall back to a first hostel (`check:invariants` will reject it). Then, instead of generating a PDF, compose:

```ts
const document = buildAgreementDocument(
  agreementDocumentInputFromRenderData(mockData as any, {
    reference: "PREVIEW",
    versionNumber: Number(body.version_number ?? 0) || 0,
    status: "DRAFT",
    verificationUrl: null,
  }),
);
return apiResponse({ document });
```

Set `isFinal: false` behaviour by leaving unresolved tokens visible — the resolver hardcodes `isFinal: true`, so pass the preview through a small override rather than changing the resolver, and add a test that an unknown token shows as written in a preview but blanks in an issued agreement.

- [ ] **Step 4: Run the tests and the invariant check**

```bash
cd apps/backend && npx vitest run tests/agreement-owner-preview-endpoint.test.ts && npm run check:invariants
```

Expected: PASS; `check:invariants` shows only the two pre-existing failures (`invite-settlement-preview`, `complete-profile`, `onboarding-settings`, `service-requests/messages`, `invitation-delivery-trust`) and no new files.

- [ ] **Step 5: Commit**

```bash
git add "apps/backend/app/api/owner/hostels/[id]/agreement-template/document" apps/backend/tests/agreement-owner-preview-endpoint.test.ts
git commit -m "feat(agreements): owners preview the real composed document"
```

---

### Task 3: Pure editor logic — token insertion and the diff

Both are decisions, so both are pure modules with their own tests. The UI tasks then have nothing left to get wrong.

**Files:**
- Modify: `apps/frontend/src/features/owner-more/config/agreementDraft.ts`
- Create: `apps/frontend/src/features/owner-more/agreement/agreementDiff.ts`
- Test: `apps/frontend/src/features/owner-more/config/agreementDraft.test.ts` (extend), `apps/frontend/src/features/owner-more/agreement/agreementDiff.test.ts`

**Interfaces:**
- Produces:
  - `insertToken(value: string, selectionStart: number, token: string): { value: string; caret: number }`
  - `editTerm(content: RulesContent, termId: string, text: string): RulesContent`
  - `diffAgreementDocument(before: AgreementDocument | null, after: AgreementDocument): DocumentDiff`
  - `type DocumentDiff = { added: string[]; removed: string[]; changed: string[]; unchanged: number }`

- [ ] **Step 1: Write the failing tests**

```ts
// agreementDraft.test.ts — append
import { editTerm, insertToken } from './agreementDraft';

describe('insertToken', () => {
  it('inserts at the caret', () => {
    expect(insertToken('Rent is  per month', 8, '{{MONTHLY_RENT}}'))
      .toEqual({ value: 'Rent is {{MONTHLY_RENT}} per month', caret: 8 + '{{MONTHLY_RENT}}'.length });
  });

  it('appends when the caret is at the end', () => {
    expect(insertToken('Rent is ', 8, '{{X}}').value).toBe('Rent is {{X}}');
  });

  it('treats a caret past the end as the end', () => {
    expect(insertToken('abc', 99, '{{X}}').value).toBe('abc{{X}}');
  });

  it('treats a negative caret as the start', () => {
    expect(insertToken('abc', -3, '{{X}}').value).toBe('{{X}}abc');
  });

  it('inserts into an empty line', () => {
    expect(insertToken('', 0, '{{X}}')).toEqual({ value: '{{X}}', caret: 5 });
  });

  it('leaves the caret after the token so typing continues naturally', () => {
    const out = insertToken('ab', 1, '{{X}}');
    expect(out.value.slice(0, out.caret)).toBe('a{{X}}');
  });
});

describe('editTerm', () => {
  const content = {
    categories: [{ id: 'fees', title: 'Fees', rules: ['Due on the 5th.'] }],
    terms_and_conditions: [
      { id: 'rent_payment', title: 'Rent Payment', content: 'Payable in advance.' },
      { id: 'notice_period', title: 'Notice Period', content: 'Thirty days.' },
    ],
  };

  it('rewrites only the named term', () => {
    const out = editTerm(content, 'notice_period', 'Sixty days.');
    expect(out.terms_and_conditions).toEqual([
      { id: 'rent_payment', title: 'Rent Payment', content: 'Payable in advance.' },
      { id: 'notice_period', title: 'Notice Period', content: 'Sixty days.' },
    ]);
  });

  it('never changes a title -- headings are fixed', () => {
    const out = editTerm(content, 'notice_period', 'Sixty days.');
    expect(out.terms_and_conditions!.map((t: any) => t.title)).toEqual(['Rent Payment', 'Notice Period']);
  });

  it('preserves order', () => {
    const out = editTerm(content, 'rent_payment', 'Due on the 1st.');
    expect(out.terms_and_conditions!.map((t: any) => t.id)).toEqual(['rent_payment', 'notice_period']);
  });

  it('leaves the rules band untouched', () => {
    expect(editTerm(content, 'notice_period', 'x').categories).toEqual(content.categories);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(content);
    editTerm(content, 'notice_period', 'Sixty days.');
    expect(JSON.stringify(content)).toBe(before);
  });

  it('is a no-op for an id that is not a canonical term', () => {
    expect(editTerm(content, 'invented', 'x').terms_and_conditions).toEqual(content.terms_and_conditions);
  });
});
```

```ts
// agreementDiff.test.ts
import { describe, expect, it } from 'vitest';
import { diffAgreementDocument } from './agreementDiff';
import type { AgreementDocument } from '@features/agreements/document/agreementDocument';

const doc = (sections: Array<[string, string]>): AgreementDocument => ({
  reference: 'x', contentHash: 'h',
  blocks: sections.map(([title, text], i) => ({
    kind: 'section', number: i + 1, title,
    clauses: [{ number: `${i + 1}`, text }],
    origin: 'owner', band: 'rules',
  })) as any,
  meta: {} as any,
});

describe('diffAgreementDocument', () => {
  it('reports nothing for an identical document', () => {
    const d = doc([['Fees', 'Due on the 5th.']]);
    expect(diffAgreementDocument(d, d)).toEqual({ added: [], removed: [], changed: [], unchanged: 1 });
  });

  it('names an added section', () => {
    expect(diffAgreementDocument(doc([['Fees', 'a']]), doc([['Fees', 'a'], ['Wi-Fi', 'b']])).added)
      .toEqual(['Wi-Fi']);
  });

  it('names a removed section', () => {
    expect(diffAgreementDocument(doc([['Fees', 'a'], ['Wi-Fi', 'b']]), doc([['Fees', 'a']])).removed)
      .toEqual(['Wi-Fi']);
  });

  it('names a reworded section as changed, not as add plus remove', () => {
    const d = diffAgreementDocument(doc([['Fees', 'a']]), doc([['Fees', 'b']]));
    expect(d).toMatchObject({ added: [], removed: [], changed: ['Fees'] });
  });

  it('treats everything as added when nothing is published yet', () => {
    expect(diffAgreementDocument(null, doc([['Fees', 'a']])).added).toEqual(['Fees']);
  });

  it('counts sections that did not move', () => {
    expect(diffAgreementDocument(doc([['Fees', 'a'], ['Wi-Fi', 'b']]), doc([['Fees', 'a'], ['Wi-Fi', 'c']])).unchanged)
      .toBe(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd apps/frontend && npx vitest run src/features/owner-more/config/agreementDraft.test.ts src/features/owner-more/agreement/agreementDiff.test.ts
```

Expected: FAIL — neither export exists.

- [ ] **Step 3: Implement `insertToken`**

```ts
/**
 * Insert a variable token at the caret.
 *
 * Replaces a DOM-reaching hack: the editor used to find its own textarea with
 * `closest('div')?.parentElement?.querySelector('textarea')` and assign
 * `el.value` directly, so React state and the DOM disagreed until blur — and a
 * token inserted then edited could be lost entirely.
 */
export function insertToken(
  value: string,
  selectionStart: number,
  token: string,
): { value: string; caret: number } {
  const text = String(value ?? '');
  const at = Math.max(0, Math.min(selectionStart ?? text.length, text.length));
  return { value: `${text.slice(0, at)}${token}${text.slice(at)}`, caret: at + token.length };
}
```

Then `editTerm(content, termId, text)`: writes `content.terms_and_conditions` immutably, preserving order, every other term, and **every title** — a title arriving from the client is ignored here as well as on the server (Task 1), so the two agree. An unrecognised id is a no-op. Keep it beside the existing `editLine`/`addLine` helpers and match their style.

- [ ] **Step 4: Implement `diffAgreementDocument`**

Key sections by **title**, compare the joined clause text. Same title + different text → `changed`. Title only in `after` → `added`. Title only in `before` → `removed`. `before === null` → everything `added`. Comment why titles rather than numbers: numbers shift when a section is added above, which would report the whole document as changed.

- [ ] **Step 5: Run the tests**

```bash
cd apps/frontend && npx vitest run src/features/owner-more/config/agreementDraft.test.ts src/features/owner-more/agreement/agreementDiff.test.ts
```

Expected: PASS.

- [ ] **Step 6: Prove the tests bite**

Break one rule deliberately — e.g. make `insertToken` always append — re-run, confirm failures, then restore. A test that passes against a broken implementation is not protecting anything.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/owner-more
git commit -m "feat(agreements): pure token insertion and publish diff"
```

---

### Task 4: Workspace state, as a pure module

**Files:**
- Create: `apps/frontend/src/features/owner-more/agreement/agreementWorkspace.ts`
- Test: `apps/frontend/src/features/owner-more/agreement/agreementWorkspace.test.ts`

**Interfaces:**
- Produces:
  - `saveStateLabel(s: { saving: boolean; unsaved: boolean; hasDraft: boolean; savedAt: Date | null }): string`
  - `publishReadiness(a: { hasDraftChanges: boolean; unknownTokens: string[]; signatureConfigured: boolean; affectedTenants: number }): { canPublish: boolean; blockers: string[]; warnings: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { publishReadiness, saveStateLabel } from './agreementWorkspace';

describe('publishReadiness', () => {
  const ok = { hasDraftChanges: true, unknownTokens: [], signatureConfigured: true, affectedTenants: 4 };

  it('allows publishing a changed, valid draft', () => {
    expect(publishReadiness(ok)).toEqual({ canPublish: true, blockers: [], warnings: [] });
  });

  it('has nothing to publish when the draft matches what is live', () => {
    expect(publishReadiness({ ...ok, hasDraftChanges: false }).canPublish).toBe(false);
  });

  it('blocks on an unknown token, naming it', () => {
    // A typo'd token prints literally on a document somebody signs.
    const r = publishReadiness({ ...ok, unknownTokens: ['{{MONTLY_RENT}}'] });
    expect(r.canPublish).toBe(false);
    expect(r.blockers.join(' ')).toContain('MONTLY_RENT');
  });

  it('warns but does not block when the signature is missing', () => {
    // Their choice; an unsigned agreement is still a real document.
    const r = publishReadiness({ ...ok, signatureConfigured: false });
    expect(r.canPublish).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it('reports both a blocker and a warning together', () => {
    const r = publishReadiness({ ...ok, unknownTokens: ['{{X}}'], signatureConfigured: false });
    expect(r.blockers).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('saveStateLabel', () => {
  it('says saving while a save is in flight', () => {
    expect(saveStateLabel({ saving: true, unsaved: true, hasDraft: true, savedAt: null })).toBe('Saving…');
  });
  it('says unsaved changes when edits have not landed', () => {
    expect(saveStateLabel({ saving: false, unsaved: true, hasDraft: true, savedAt: null })).toBe('Unsaved changes');
  });
  it('says draft saved once a save has landed', () => {
    expect(saveStateLabel({ saving: false, unsaved: false, hasDraft: true, savedAt: new Date() })).toBe('Draft saved');
  });
  it('says it matches the published version when there is no draft', () => {
    expect(saveStateLabel({ saving: false, unsaved: false, hasDraft: false, savedAt: null }))
      .toBe('Matches the published version');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/frontend && npx vitest run src/features/owner-more/agreement/agreementWorkspace.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement to satisfy the tests**

Blockers stop the publish; warnings do not. The unknown-token blocker names every offending token so the owner can find it.

- [ ] **Step 4: Run the test, then commit**

```bash
cd apps/frontend && npx vitest run src/features/owner-more/agreement/agreementWorkspace.test.ts
git add apps/frontend/src/features/owner-more/agreement
git commit -m "feat(agreements): publish readiness and save state as pure rules"
```

---

### Task 5: The workspace screen

**Files:**
- Create: `AgreementWorkspacePage.tsx`, `WriteSegment.tsx`, `ReadSegment.tsx`, `SectionRow.tsx`, `ownerAgreementApi.ts`
- Modify: `OwnerRoutes.tsx`, `config/agreementSections.ts`

- [ ] **Step 1: API wrappers**

Through `@lib/api-client` only. `fetchOwnerAgreementDocument(hostelId, draft)` posts the draft to the Task 2 endpoint; reuse the existing `configApi.saveAgreementDraft` / `publishAgreementTemplate`. Also add `downloadSamplePdf(hostelId, draft)`, which finally calls the **long-dead** `agreement-template/preview` endpoint (`responseType: 'blob'`) — it has existed with zero callers since it was written.

- [ ] **Step 2: The page shell**

`/owner/more/configuration/agreements` becomes the workspace. A segmented control switches **Write** / **Read**. Header shows the title, version, clause count, and `saveStateLabel(...)`. One sticky bottom bar with the publish action, using `pb-[max(0.75rem,env(safe-area-inset-bottom))]` — **not** `bottom-[68px]`, which is what makes the current bar float mid-screen on desktop.

- [ ] **Step 3: Write segment**

Three groups in band order: **Your terms** (the five fixed headings, body editable, no delete/reorder controls — the affordances must not exist, not merely refuse), **Your rules** (the existing categories, full add/edit/reorder/remove), and a read-only note naming the platform clauses so the owner knows they are there and why they cannot be edited.

Per line: tap to edit an autosize textarea that commits **`onChange`** — the current editor commits on `onBlur`, which drops an edit when the owner taps straight onto another line. Per-line actions collapse into one `⋯` (move up/down, duplicate, delete); section actions into a section `⋯`. The variable picker uses `insertToken` against a ref — no `closest('div')`.

- [ ] **Step 4: Read segment**

`<AgreementDocumentView doc={...} />` fed by the Task 2 endpoint — the same component the tenant reads, so the owner is looking at the tenant's view by construction. Below it, a secondary "Download a sample PDF" action.

- [ ] **Step 5: Routing**

One route replaces four. Keep `/agreements/requirement` and `/agreements/signature`. Redirect `/agreements/templates`, `/agreements/template`, `/agreements/edit` and `/agreements/clauses` to the workspace so existing links and any bookmarks still land somewhere real.

- [ ] **Step 6: Verify**

```bash
cd apps/frontend && npm run check:architecture && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "owner-more/agreement" ; npm test && npm run build
```

Expected: architecture passes, no new type errors in touched files, tests pass, build passes (it runs `check:architecture` and the branding check).

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(agreements): one workspace for writing the agreement"
```

---

### Task 6: Publish becomes a review

**Files:**
- Create: `PublishReviewSheet.tsx`
- Modify: `AgreementWorkspacePage.tsx`

- [ ] **Step 1: Build the sheet**

Opens on the publish tap. Shows `diffAgreementDocument(published, draft)` as three short lists (added / removed / reworded) with a count of unchanged sections; `publishReadiness(...)`'s blockers and warnings; and the blast radius — "N future tenants will sign this". Confirm is disabled while any blocker stands.

The count comes from the existing `agreements_count` on the template summary; if it is not reachable without a new endpoint, **say "future tenants" without a number** rather than inventing one.

- [ ] **Step 2: Replace the bare publish**

The bottom bar opens the sheet instead of mutating. The mutation moves behind the sheet's confirm, still sending the on-screen draft explicitly — the route resolves `rules_content || DEFAULT_AGREEMENT_TEMPLATE` and deletes the draft in the same transaction, so publishing without the content would overwrite the owner's work with the stock template.

- [ ] **Step 3: Verify and commit**

```bash
cd apps/frontend && npm test && npm run build
git add apps/frontend/src
git commit -m "feat(agreements): publishing shows what changes and who it affects"
```

---

### Task 7: Delete the dead code

- [ ] **Step 1: Confirm each is genuinely unreferenced**

```bash
cd apps/frontend
grep -rn "deriveAgreementSections" src --include=*.tsx --include=*.ts | grep -v "config/agreements"
grep -rn "agreements/variables" src
grep -rn "MoreConfigAgreement\(Clauses\|Template\|Templates\|Editor\)Page" src
```

Only test files and the definitions themselves should remain.

- [ ] **Step 2: Delete**

`deriveAgreementSections` and its block in `config/agreements.test.ts`; the four replaced pages. **Keep** `AGREEMENT_VARIABLES`, `countClauses`, `usedVariables`, `splitByVariables`, `summarizeTemplate`, `severityLabel` — they are live.

- [ ] **Step 3: Verify nothing else depended on them**

```bash
cd apps/frontend && npm run check:architecture && npm test && npm run build
```

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(agreements): remove the screens the workspace replaced

deriveAgreementSections was unused but still tested, and routed to
/agreements/variables, which was never a route."
```

---

### Task 8: Desktop (spec §5.6 — two-column at `lg:`)

- [ ] **Step 1: Two columns at `lg:`**

Sections left, live document right, both scrolling independently. Below `lg:` the segmented control stays. The point is that the same code serves a laptop properly instead of being a stretched phone screen.

- [ ] **Step 2: Check the real breakpoints**

```bash
cd apps/frontend && npm run build
```

Then open the workspace at 390px, 768px and 1440px. **This is a manual step and it is not optional** — every layout claim in Phase 1 went unverified because nothing was ever opened in a browser.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(agreements): the workspace gets a real desktop layout"
```

---

### Task 9: Documentation

- [ ] **Step 1: `Decisions.md`** — one ADR (number from Task 0 Step 2): owners write the commercial terms, headings fixed; the five-into-one workspace; publishing as a reviewed act.
- [ ] **Step 2: `Business-Rules.md`** — the canonical five terms, that headings are fixed and enforced server-side, and that a blank or omitted term falls back to Stayo's wording.
- [ ] **Step 3: `APIs.md`** — the new owner document endpoint, and note that `agreement-template/preview` finally has a caller.
- [ ] **Step 4: `Features.md` + `Changelog.md`** — the workspace, with wiki links to at least one related note each.
- [ ] **Step 5: `Bugs.md`** — the `onBlur` edit loss and the DOM-reaching token inserter, both of which could put wrong text on a signed document.
- [ ] **Step 6: Commit**

```bash
git add docs/obsidian
git commit -m "docs(obsidian): owner agreement workspace and editable terms"
```

---

## Phase 2 exit criteria

- [ ] `cd apps/frontend && npm test && npm run build` — green
- [ ] `cd apps/backend && npm run check:invariants` — no new failures beyond the two pre-existing
- [ ] `cd apps/backend && npx vitest run tests/agreement-*.test.ts` — no new failures (the full suite cannot pass; the test DB is gone)
- [ ] An owner can change their notice period and see it in the Read segment
- [ ] The Read segment and the tenant's reader render from the same endpoint shape and the same component
- [ ] Publishing states what changed before it happens
- [ ] **Opened in a browser at 390px and 1440px** — not inferred from a passing build

## Deferred to Phase 3

Import rebuild (paste → parse → review), the existing-tenant reader at `/tenant/agreement`, and unifying the PDF's two clause presentations so the PDF and the reader number clauses identically.
