# Legal Policy Set — Phase 1 (Documents & Content Architecture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Stayo's legal documents with a typed, versioned content system carrying seven legally-correct policies, so Easebuzz merchant onboarding and Meta Business Verification are unblocked.

**Architecture:** `apps/frontend/src/content/legal.ts` (a flat, untyped array rendered through `block: any`) becomes `src/content/legal/` — a typed discriminated union of content blocks, one module per document, and a registry that owns each document's version, effective date, route and aliases. Route→document resolution and table-of-contents extraction become pure functions tested directly, per this app's node-only test convention. The divergent backend copy is deleted, and a `check-legal.mjs` invariant guards the rules that must not silently regress.

**Tech Stack:** TypeScript, Vite + React 19 SPA, vitest (node environment, no jsdom), Node ESM scripts for build-time invariants.

**Spec:** `docs/superpowers/specs/2026-09-10-legal-policies-production-design.md` — read it alongside this plan. Substantive legal positions live in spec §6 and are referenced per task rather than duplicated here.

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from the spec.

- **Entity:** Trishul Solutions, a sole proprietorship of **Chidiri Shiva Prakash**. No separate legal personality; the contracting party is the proprietor personally.
- **Principal place of business:** 12-75/1, Balaji Nagar, Block 2, Kodangal, Vikarabad District, Telangana 509338.
- **Grievance Officer:** Chidiri Shiva Prakash, `grievance@yourstayo.com`.
- **Not GST-registered.** Never claim a GSTIN; never show GST on any Stayo invoice. Fees are exclusive of taxes, applicable *if and when* Stayo becomes liable to register.
- **Money model:** Easebuzz **sub-merchant**. Each owner is the merchant of record; resident payments settle **directly to the owner**. Stayo is never in the flow of funds and never refunds resident money.
- **Revenue:** the owner subscription is Stayo's **only** revenue — no share of transaction fees or TDR. Terms state affirmatively that *Stayo earns nothing from your rent*.
- **Jurisdiction:** Hyderabad, Telangana — drafted **non-exclusive** (spec §6.1; an exclusive clause naming a court without nexus is void as ousting jurisdiction under s.20 CPC).
- **Payment partner naming:** the aggregator is **never named in published copy** — it is described as "an RBI-authorised payment aggregator" (spec D6/§2.2; neither RentOk nor Crib names theirs, naming is not required for onboarding, and Stayo has already changed aggregator once). `PAYMENT_PARTNER.name` exists for internal reference only; `PAYMENT_PARTNER.descriptor` is the only form that may reach a document.
- **Published contacts — exactly four:** `support@`, `grievance@`, `privacy@`, `contact@`. The proprietor's personal number and email are never published.
- **Eligibility:** account holders must be 18+; a guardian holds the account for a minor (DPDP §9).
- **Frontend tests:** node environment only, matched by `src/**/*.test.ts`. **Never** create a `.test.tsx` or render a component in a test. Decision logic goes in pure `.ts` modules; components stay thin renderers.
- **No raw `fetch()`/`axios`** in `app/`, `platforms/`, `shared/ui`, `features/`, `portal/` or `context/` — enforced by `scripts/check-architecture.mjs`.
- **Documentation is part of the change, not follow-up** — see Task 13.

**Working directory:** all `npm`/`npx` commands run from `apps/frontend` unless stated otherwise.

**Branch:** create `feat/legal-policies` off `dev` before Task 1 (`git checkout dev && git pull && git checkout -b feat/legal-policies`). Never push to `main`.

---

### Task 1: Entity and payment-partner constants

Extends the existing identity source of truth rather than adding a second one, so the Trishul → Stayo → legal-entity chain is asserted from one place.

**Files:**
- Modify: `apps/frontend/src/content/company.ts`
- Test: `apps/frontend/src/content/company.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `COMPANY.legal` (`{ proprietor, constitution, address: {line1, line2, locality, district, state, pin}, grievanceOfficer: {name, email} }`), `formatPostalAddress(address): string`, and `PAYMENT_PARTNER` (`{ name: 'Easebuzz', descriptor: 'an RBI-authorised payment aggregator' }`). Tasks 3–7 and 12 consume these.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/content/company.test.ts
import { describe, expect, it } from 'vitest';
import { COMPANY, PAYMENT_PARTNER, formatPostalAddress } from './company';

describe('COMPANY.legal', () => {
  it('names the proprietor, because a proprietorship contracts through the individual', () => {
    expect(COMPANY.legal.proprietor).toBe('Chidiri Shiva Prakash');
    expect(COMPANY.legal.constitution).toBe('sole proprietorship');
  });

  it('carries no unresolved placeholders — the build must never publish one', () => {
    const values = [
      COMPANY.legal.proprietor,
      COMPANY.legal.grievanceOfficer.name,
      COMPANY.legal.grievanceOfficer.email,
      ...Object.values(COMPANY.legal.address),
    ];
    for (const value of values) {
      expect(value).toBeTruthy();
      expect(value).not.toMatch(/\[|TBD|TODO|XXX/i);
    }
  });

  it('publishes only the four serviced addresses', () => {
    expect(Object.keys(COMPANY.emails).sort()).toEqual(['contact', 'grievance', 'privacy', 'support']);
  });

  it('never claims a GSTIN', () => {
    expect(JSON.stringify(COMPANY)).not.toMatch(/gstin/i);
  });
});

describe('formatPostalAddress', () => {
  it('renders the registered address as one postal line', () => {
    expect(formatPostalAddress(COMPANY.legal.address)).toBe(
      '12-75/1, Balaji Nagar, Block 2, Kodangal, Vikarabad District, Telangana 509338',
    );
  });
});

describe('PAYMENT_PARTNER', () => {
  it('is the only place the aggregator is named, and the name never reaches published copy', () => {
    expect(PAYMENT_PARTNER.name).toBe('Easebuzz');
    expect(PAYMENT_PARTNER.descriptor).toBe('an RBI-authorised payment aggregator');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/content/company.test.ts`
Expected: FAIL — `COMPANY.legal` is undefined and `PAYMENT_PARTNER` / `formatPostalAddress` are not exported.

- [ ] **Step 3: Implement**

In `apps/frontend/src/content/company.ts`:

1. **Replace the stale privacy claim in the file header comment.** The existing line "Office address and registration IDs are deliberately NOT surfaced publicly" is superseded by spec D2 — the Consumer Protection (E-Commerce) Rules 2020 and IT Rules 2021 require them. Replace it with a note that the registered address and Grievance Officer are published as those rules require, while the proprietor's *personal* contacts are not.
2. **Replace the `emails` block** with exactly the four serviced addresses (`contact`, `support`, `privacy`, `grievance`) — dropping `legal` and any other alias, per the global constraints.
3. Add the `legal` block and the two new exports:

```ts
export interface PostalAddress {
  line1: string;
  line2: string;
  locality: string;
  district: string;
  state: string;
  pin: string;
}

/** One postal line, in the order an Indian address is read. */
export function formatPostalAddress(a: PostalAddress): string {
  return `${a.line1}, ${a.line2}, ${a.locality}, ${a.district}, ${a.state} ${a.pin}`;
}

/**
 * The aggregator, in the only place it is named.
 *
 * `descriptor` is the ONLY form that may appear in a published document;
 * `name` exists for internal and operational reference. Stayo changed
 * aggregator once already and the previous name was left scattered through six
 * documents and a live pay sheet. Naming a gateway in published copy buys
 * nothing — it is not required for aggregator onboarding, and neither RentOk
 * nor Crib does it — while guaranteeing stale copy on the next change.
 * `scripts/check-legal.mjs` fails the build if `name` appears under src/content.
 */
export const PAYMENT_PARTNER = {
  name: 'Easebuzz',
  descriptor: 'an RBI-authorised payment aggregator',
} as const;
```

Inside the `COMPANY` object, add:

```ts
  /**
   * Published because the Consumer Protection (E-Commerce) Rules 2020 and the
   * IT Rules 2021 require an e-commerce entity to display its legal name,
   * registered address and a named Grievance Officer. The proprietor's
   * personal phone and email are deliberately NOT here — nothing obliges
   * publishing those, and legal pages get scraped.
   */
  legal: {
    proprietor: 'Chidiri Shiva Prakash',
    constitution: 'sole proprietorship',
    address: {
      line1: '12-75/1',
      line2: 'Balaji Nagar',
      locality: 'Block 2, Kodangal',
      district: 'Vikarabad District',
      state: 'Telangana',
      pin: '509338',
    } satisfies PostalAddress,
    grievanceOfficer: {
      name: 'Chidiri Shiva Prakash',
      email: 'grievance@yourstayo.com',
    },
  },
```

- [ ] **Step 4: Fix the callers the email change breaks**

Run: `npx tsc --noEmit` and `grep -rn "emails.legal" src/`
Expected: `LegalPage.tsx` references `COMPANY.emails.legal`. Repoint every such reference to `COMPANY.emails.grievance`. Re-run `npx tsc --noEmit` until clean.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/content/company.test.ts`
Expected: PASS (7 assertions across 6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/content/company.ts apps/frontend/src/content/company.test.ts apps/frontend/src/app/pages/LegalPage.tsx
git commit -m "feat(legal): publish entity facts and centralise the payment-partner name

The Consumer Protection (E-Commerce) Rules 2020 and IT Rules 2021 require
the legal name, registered address and a named Grievance Officer to be
published, superseding the previous stance that they stay private. The
proprietor's personal contacts remain unpublished.

PAYMENT_PARTNER is the single place the aggregator is named, so a future
gateway change is one edit rather than a hunt through six documents."
```

---

### Task 2: Legal block type system and pure helpers

**Files:**
- Create: `apps/frontend/src/content/legal/types.ts`
- Create: `apps/frontend/src/content/legal/documentHelpers.ts`
- Test: `apps/frontend/src/content/legal/documentHelpers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LegalBlock` (discriminated union), `LegalDocument`, `LegalAudience`; `documentAnchors(doc): Anchor[]`, `documentIdForPath(pathname, docs): string | null`, `allRoutes(docs): string[]`, `validateRegistry(docs): string[]`. Tasks 3–9 and 12 consume these.

- [ ] **Step 1: Write `types.ts`**

```ts
// apps/frontend/src/content/legal/types.ts

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
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/frontend/src/content/legal/documentHelpers.test.ts
import { describe, expect, it } from 'vitest';
import type { LegalDocument } from './types';
import { documentAnchors, documentIdForPath, allRoutes, validateRegistry } from './documentHelpers';

const doc = (over: Partial<LegalDocument> = {}): LegalDocument => ({
  id: 'terms',
  title: 'Terms of Use',
  route: '/legal/terms',
  aliases: ['/terms'],
  version: '1.0',
  effectiveDate: '2026-09-10',
  summary: ['Stayo is a platform, not your landlord.'],
  audience: 'all',
  material: true,
  metaDescription: 'Terms of Use for the Stayo platform.',
  content: [
    { type: 'subheading', id: 'scope', text: 'Scope' },
    { type: 'clause', id: 'clause-1-1', number: '1.1', text: 'These terms apply to everyone.' },
    { type: 'paragraph', text: 'Not an anchor.' },
  ],
  ...over,
});

describe('documentAnchors', () => {
  it('extracts subheadings and clauses, ignoring prose', () => {
    expect(documentAnchors(doc())).toEqual([
      { id: 'scope', text: 'Scope', level: 'section' },
      { id: 'clause-1-1', text: '1.1', level: 'clause' },
    ]);
  });
});

describe('documentIdForPath', () => {
  const docs = [doc(), doc({ id: 'privacy', route: '/legal/privacy', aliases: ['/privacy'] })];

  it('resolves a canonical route', () => {
    expect(documentIdForPath('/legal/terms', docs)).toBe('terms');
  });

  it('resolves an alias, because old URLs stay registered with aggregators', () => {
    expect(documentIdForPath('/terms', docs)).toBe('terms');
    expect(documentIdForPath('/privacy', docs)).toBe('privacy');
  });

  it('ignores a trailing slash', () => {
    expect(documentIdForPath('/legal/privacy/', docs)).toBe('privacy');
  });

  it('returns null for the hub and for anything unknown', () => {
    expect(documentIdForPath('/legal', docs)).toBeNull();
    expect(documentIdForPath('/nope', docs)).toBeNull();
  });
});

describe('allRoutes', () => {
  it('returns canonical routes and aliases together', () => {
    expect(allRoutes([doc()])).toEqual(['/legal/terms', '/terms']);
  });
});

describe('validateRegistry', () => {
  it('passes a well-formed registry', () => {
    expect(validateRegistry([doc()])).toEqual([]);
  });

  it('rejects a missing version, effective date or summary', () => {
    expect(validateRegistry([doc({ version: '' })])).toContain('terms: missing version');
    expect(validateRegistry([doc({ effectiveDate: '' })])).toContain('terms: missing effectiveDate');
    expect(validateRegistry([doc({ summary: [] })])).toContain('terms: missing summary');
  });

  it('rejects a non-ISO effective date, so sorting and display cannot drift', () => {
    expect(validateRegistry([doc({ effectiveDate: 'June 2026' })])).toContain(
      'terms: effectiveDate must be ISO yyyy-mm-dd',
    );
  });

  it('rejects two documents claiming the same route', () => {
    const clash = [doc(), doc({ id: 'other', aliases: [] })];
    expect(validateRegistry(clash)).toContain('/legal/terms: claimed by more than one document');
  });

  it('rejects a duplicate anchor id, which would break deep links', () => {
    const dupe = doc({
      content: [
        { type: 'subheading', id: 'scope', text: 'Scope' },
        { type: 'subheading', id: 'scope', text: 'Scope again' },
      ],
    });
    expect(validateRegistry([dupe])).toContain('terms: duplicate anchor id "scope"');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/content/legal/documentHelpers.test.ts`
Expected: FAIL — cannot resolve `./documentHelpers`.

- [ ] **Step 4: Implement `documentHelpers.ts`**

```ts
// apps/frontend/src/content/legal/documentHelpers.ts
import type { Anchor, LegalDocument } from './types';

/** Section and clause anchors, in document order — the table of contents. */
export function documentAnchors(doc: LegalDocument): Anchor[] {
  const anchors: Anchor[] = [];
  for (const block of doc.content) {
    if (block.type === 'subheading') {
      anchors.push({ id: block.id, text: block.text, level: 'section' });
    } else if (block.type === 'clause') {
      anchors.push({ id: block.id, text: block.number, level: 'clause' });
    }
  }
  return anchors;
}

function normalise(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Which document a URL is asking for, canonical route or alias.
 *
 * Replaces the hand-written if/else chain the previous LegalPage carried: that
 * chain and the route table were edited separately, so a route could exist
 * with nothing rendering it.
 */
export function documentIdForPath(pathname: string, docs: LegalDocument[]): string | null {
  const path = normalise(pathname);
  for (const doc of docs) {
    if (doc.route === path || doc.aliases.includes(path)) return doc.id;
  }
  return null;
}

/** Every path that must resolve — canonical routes first, then aliases. */
export function allRoutes(docs: LegalDocument[]): string[] {
  return docs.flatMap((doc) => [doc.route, ...doc.aliases]);
}

/**
 * Structural rules a published registry must satisfy. Returns failures rather
 * than throwing, so the test can assert on all of them at once.
 */
export function validateRegistry(docs: LegalDocument[]): string[] {
  const failures: string[] = [];
  const seenRoutes = new Map<string, string>();

  for (const doc of docs) {
    if (!doc.version) failures.push(`${doc.id}: missing version`);
    if (!doc.effectiveDate) failures.push(`${doc.id}: missing effectiveDate`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.effectiveDate)) {
      failures.push(`${doc.id}: effectiveDate must be ISO yyyy-mm-dd`);
    }
    if (!doc.summary.length) failures.push(`${doc.id}: missing summary`);
    if (!doc.metaDescription) failures.push(`${doc.id}: missing metaDescription`);
    if (!doc.content.length) failures.push(`${doc.id}: empty content`);

    for (const route of [doc.route, ...doc.aliases]) {
      const owner = seenRoutes.get(route);
      if (owner && owner !== doc.id) failures.push(`${route}: claimed by more than one document`);
      seenRoutes.set(route, doc.id);
    }

    const seenAnchors = new Set<string>();
    for (const anchor of documentAnchors(doc)) {
      if (seenAnchors.has(anchor.id)) failures.push(`${doc.id}: duplicate anchor id "${anchor.id}"`);
      seenAnchors.add(anchor.id);
    }
  }

  return failures;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/content/legal/documentHelpers.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/content/legal/
git commit -m "feat(legal): typed block vocabulary and registry helpers

Replaces the untyped block array with a discriminated union that can
express numbered clauses, lists, tables and definitions, and moves
route resolution and table-of-contents extraction into pure functions
so they are testable under this app's node-only test setup."
```

---

### Task 3: Registry and the Terms of Use

Writes the registry plus the first and largest document. The registry invariant test lands here because this is the first task where there is a real registry to validate.

**Files:**
- Create: `apps/frontend/src/content/legal/terms.ts`
- Create: `apps/frontend/src/content/legal/index.ts`
- Test: `apps/frontend/src/content/legal/registry.test.ts`

**Interfaces:**
- Consumes: `LegalDocument`, `LegalBlock` (Task 2); `COMPANY`, `PAYMENT_PARTNER`, `formatPostalAddress` (Task 1).
- Produces: `termsDocument: LegalDocument` and `legalDocuments: LegalDocument[]` (the registry). Tasks 4–9 and 12 append to and consume the registry.

**Content source:** spec §6.1 (core), §6.2 (Schedule A — Owners), §6.3 (Schedule B — Residents). Write the prose from those positions; every position listed there must appear as a clause. Do not invent obligations the spec does not state.

- [ ] **Step 1: Write the failing registry test**

```ts
// apps/frontend/src/content/legal/registry.test.ts
import { describe, expect, it } from 'vitest';
import { legalDocuments } from './index';
import { validateRegistry, documentIdForPath } from './documentHelpers';
import { PAYMENT_PARTNER } from '../company';

describe('the published legal registry', () => {
  it('satisfies every structural rule', () => {
    expect(validateRegistry(legalDocuments)).toEqual([]);
  });

  it('carries no unresolved placeholder in any published string', () => {
    const text = JSON.stringify(legalDocuments);
    expect(text).not.toMatch(/\bTBD\b|\bTODO\b|\[PROPRIETOR|\[ADDRESS|XXX/i);
  });

  it('never claims a GSTIN, because the proprietorship is not GST-registered', () => {
    expect(JSON.stringify(legalDocuments)).not.toMatch(/gstin/i);
  });

  it('names no payment provider at all — published copy describes, never names', () => {
    const text = JSON.stringify(legalDocuments);
    for (const provider of [
      PAYMENT_PARTNER.name, 'Razorpay', 'PhonePe', 'Cashfree', 'Paytm', 'PayU', 'CCAvenue', 'Stripe',
    ]) {
      expect(text).not.toContain(provider);
    }
    expect(text).toContain(PAYMENT_PARTNER.descriptor);
  });

  it('resolves every route and alias it declares', () => {
    for (const doc of legalDocuments) {
      for (const route of [doc.route, ...doc.aliases]) {
        expect(documentIdForPath(route, legalDocuments)).toBe(doc.id);
      }
    }
  });
});

describe('the Terms of Use', () => {
  const terms = legalDocuments.find((d) => d.id === 'terms')!;

  it('is registered', () => {
    expect(terms).toBeDefined();
    expect(terms.route).toBe('/legal/terms');
    expect(terms.aliases).toContain('/terms');
  });

  it('states jurisdiction as non-exclusive — an exclusive clause without nexus is void', () => {
    const text = JSON.stringify(terms.content);
    expect(text).toContain('Hyderabad');
    expect(text).not.toMatch(/exclusive jurisdiction/i);
  });

  it('states that Stayo earns nothing from resident rent', () => {
    expect(JSON.stringify(terms.content)).toMatch(/earns? nothing from your rent/i);
  });

  it('requires account holders to be 18 or over', () => {
    expect(JSON.stringify(terms.content)).toMatch(/18/);
  });

  it('carries both schedules', () => {
    const ids = terms.content.filter((b) => b.type === 'subheading').map((b: any) => b.id);
    expect(ids).toContain('schedule-a');
    expect(ids).toContain('schedule-b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/content/legal/registry.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write `terms.ts`**

Structure the document as: metadata, an `In short` summary, then content blocks in this clause order. Use `subheading` for each numbered part and `clause` blocks with ids of the form `clause-<section>-<n>`.

1. **Interpretation and who we are** — Stayo is a product of Trishul Solutions, a `COMPANY.legal.constitution` of `COMPANY.legal.proprietor`, at `formatPostalAddress(COMPANY.legal.address)`. Electronic-record clause (IT Act 2000) retained from the current terms.
2. **What Stayo is and is not** — a technology platform; the accommodation contract is resident↔owner; Stayo generates and stores the agreement but is not a party to it; Stayo is never in the flow of funds (spec §2.1, §6.1).
3. **Eligibility** — 18+, guardian holds the account for a minor.
4. **Your account** — accurate information, responsibility for account activity.
5. **Acceptable use** — including the retained prohibitions on bypassing payment mechanisms and submitting false identification.
6. **User content and reviews** — licence grant, moderation is Stayo's, takedown route via the grievance channel (spec §6.1).
7. **Fees and taxes** — fees exclusive of taxes, applicable if and when Stayo becomes liable to register; no GSTIN claimed.
8. **Intellectual property** — retained from the current terms.
9. **Disclaimers and limitation of liability** — capped at the greater of fees paid to Stayo in the preceding three months or ₹5,000 (spec §6.1; the floor exists because a residents' cap would otherwise compute to zero and be struck down as unconscionable, leaving unlimited liability).
10. **Indemnity** — retained, scoped.
11. **Suspension and termination.**
12. **Changes to these terms.**
13. **Governing law and jurisdiction** — India; *"the courts at Hyderabad, Telangana shall have jurisdiction"*. **Do not write "exclusive jurisdiction"** (Task 3 test asserts this).
14. **Arbitration** — sole arbitrator, seat Hyderabad, Arbitration and Conciliation Act 1996.
15. **Grievance redressal** — `contact_list` block naming the Grievance Officer, `grievance@yourstayo.com` and the registered address.
16. **Schedule A — Additional Terms for Hostel Owners** (`subheading` id `schedule-a`, audience `owner`) — subscription and trial; behaviour on payment failure and cancellation; owner warranties on right to let and listing accuracy; indemnity to Stayo; **sub-merchant onboarding** (owner is merchant of record, enters a direct relationship with Easebuzz, accepts its merchant terms, settlement timing and fees governed by that relationship); **KYC warranty** and Stayo's right to suspend on the partner's instruction; **the owner issues refunds** from their own account and honours the platform refund floor (spec §6.2).
17. **Schedule B — Additional Terms for Residents** (`subheading` id `schedule-b`, audience `resident`) — the account is free; **payment settles directly to the hostel's own merchant account and discharges the obligation on successful payment**; **Stayo earns nothing from your rent**; the hostel's house rules, notice period and deposit terms bind separately; what Stayo is not responsible for — room condition, food, safety, hostel conduct (spec §6.3).

Metadata: `version: '1.0'`, `effectiveDate: '2026-09-10'`, `audience: 'all'`, `material: true`.

- [ ] **Step 4: Write `index.ts`**

```ts
// apps/frontend/src/content/legal/index.ts
import type { LegalDocument } from './types';
import { termsDocument } from './terms';

/**
 * Every published legal document, in the order the hub lists them.
 *
 * This is the single registry: routes, footer links and the invariant script
 * all derive from it, so adding a document cannot leave a dangling link or an
 * unrendered route. Tasks 4-7 append here.
 */
export const legalDocuments: LegalDocument[] = [termsDocument];

export * from './types';
export * from './documentHelpers';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/content/legal/registry.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/content/legal/
git commit -m "feat(legal): registry and the Terms of Use

Terms are a shared core plus Schedule A (owners) and Schedule B
(residents), reflecting that owners buy software while residents get a
free account and pay a hostel directly through its own sub-merchant
account.

Jurisdiction is non-exclusive by design: the registered place of
business is Vikarabad District, so an exclusive clause naming Hyderabad
would be void as ousting jurisdiction."
```

---

### Task 4: Privacy Policy

**Files:**
- Create: `apps/frontend/src/content/legal/privacy.ts`
- Modify: `apps/frontend/src/content/legal/index.ts`
- Test: `apps/frontend/src/content/legal/privacy.test.ts`

**Interfaces:**
- Consumes: `LegalDocument` (Task 2), `PAYMENT_PARTNER` (Task 1), `legalDocuments` (Task 3).
- Produces: `privacyDocument: LegalDocument`, appended to `legalDocuments`.

**Content source:** spec §6.5. Route `/legal/privacy`, alias `/privacy`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/content/legal/privacy.test.ts
import { describe, expect, it } from 'vitest';
import { privacyDocument } from './privacy';

const text = () => JSON.stringify(privacyDocument.content);

describe('the Privacy Policy', () => {
  it('describes retention as anonymisation, not erasure — matching what closure actually does', () => {
    expect(text()).toMatch(/anonymis/i);
  });

  it('does not promise to delete financial records, which survive by design', () => {
    expect(text()).not.toMatch(/delete .{0,40}billing records/i);
  });

  it('describes the identity-document vault and that sharing is revocable', () => {
    expect(text()).toMatch(/revok/i);
  });

  it('does not claim to track behaviour or preferences (DPDP s.9)', () => {
    expect(text()).not.toMatch(/track your behaviour|track your preferences/i);
  });

  it('lists the Data Principal rights DPDP requires', () => {
    for (const right of ['access', 'correction', 'erasure', 'grievance', 'nomination']) {
      expect(text().toLowerCase()).toContain(right);
    }
  });

  it('states that payment credentials never reach Stayo', () => {
    expect(text()).toMatch(/never reach|do not store/i);
    expect(text()).toMatch(/CVV|card number/i);
  });

  it('names a Grievance Officer contact', () => {
    expect(text()).toContain('grievance@yourstayo.com');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/content/legal/privacy.test.ts`
Expected: FAIL — cannot resolve `./privacy`.

- [ ] **Step 3: Write `privacy.ts`**

Sections, per spec §6.5:

1. **Introduction and scope** — who the Data Fiduciary is; India-only processing.
2. **What we collect and why** — a `table` block with columns `['Data', 'Purpose', 'Why we need it']`, covering: identity and contact details; date of birth and guardian details; identity documents; tenancy and allocation data; payment references (transaction id, method type, amount, status); device and log data; support correspondence.
3. **What we never collect** — a `notice` block: full card numbers, CVV, PINs and banking passwords never reach Stayo's servers; payments are handled on the payment partner's own PCI-DSS environment.
4. **Your identity documents** — the vault: a document is held once, shared with a hostel only with the resident's consent, revocable, and verification is per-hostel so one owner's approval never verifies it everywhere.
5. **Who we share with** — categories, naming `PAYMENT_PARTNER.name` for payments; authentication, email delivery, media storage, messaging, hosting and caching disclosed by category; hostel owners receive only what their tenancy requires; legal/regulatory disclosure.
6. **Children** — 18+ eligibility; no behavioural tracking or profiling of minors.
7. **Retention** — anonymise-not-erase, with the reason: a hostel's ledger is not solely the leaver's to rewrite. Cross-reference the Data Deletion document.
8. **Your rights** — access, correction, erasure, grievance, nomination, each with the route that exercises it.
9. **Security** — reasonable security practices; TLS in transit; the user's own responsibility for credentials.
10. **Grievances and contact** — `contact_list` with the Grievance Officer, `privacy@yourstayo.com`, `grievance@yourstayo.com` and the registered address.

Metadata: `version: '1.0'`, `effectiveDate: '2026-09-10'`, `audience: 'all'`, `material: true`.

- [ ] **Step 4: Register it**

In `index.ts`, import `privacyDocument` and add it to `legalDocuments` after `termsDocument`.

- [ ] **Step 5: Run both tests to verify they pass**

Run: `npx vitest run src/content/legal/`
Expected: PASS — the privacy tests and the Task 3 registry invariants (which now cover two documents).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/content/legal/
git commit -m "feat(legal): DPDP-shaped Privacy Policy

Rewritten around what the code actually does: closure anonymises rather
than erases, and financial records survive by design, so the previous
promise to delete billing records was a misrepresentation.

Adds the identity-document vault - held once, shared per-hostel by
consent, revocable - and drops the behavioural-tracking claim, which
DPDP s.9 prohibits for the under-18s this platform serves."
```

---

### Task 5: Payments, Refunds & Cancellations

The highest-risk document in the set. Spec §6.4 carries a drafting rule that governs every sentence here.

**Files:**
- Create: `apps/frontend/src/content/legal/refunds.ts`
- Modify: `apps/frontend/src/content/legal/index.ts`
- Test: `apps/frontend/src/content/legal/refunds.test.ts`

**Interfaces:**
- Consumes: `LegalDocument` (Task 2), `PAYMENT_PARTNER` (Task 1).
- Produces: `refundsDocument: LegalDocument`, appended to `legalDocuments`.

**Content source:** spec §6.4. Route `/legal/refunds`, aliases `/refund-policy` and `/legal/refund-policy`.

**Drafting rule (spec §6.4):** every sentence must survive the test *"can Stayo actually do this without holding the money?"* Anything that fails becomes an owner obligation with a stated enforcement remedy, never a Stayo guarantee.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/content/legal/refunds.test.ts
import { describe, expect, it } from 'vitest';
import { refundsDocument } from './refunds';
import { PAYMENT_PARTNER } from '../company';

const text = () => JSON.stringify(refundsDocument.content);

describe('Payments, Refunds & Cancellations', () => {
  it('keeps its old URLs alive — aggregators may have registered them', () => {
    expect(refundsDocument.route).toBe('/legal/refunds');
    expect(refundsDocument.aliases).toEqual(expect.arrayContaining(['/refund-policy', '/legal/refund-policy']));
  });

  it('never promises that Stayo refunds resident money it never receives', () => {
    expect(text()).not.toMatch(/we will refund your rent|Stayo will refund your (rent|deposit)/i);
  });

  it('states that resident payments settle directly to the hostel', () => {
    expect(text()).toMatch(/directly to the (hostel|hostel's)/i);
  });

  it('states the enforcement remedy for the refund floor, not a Stayo guarantee', () => {
    expect(text()).toMatch(/suspend|delist/i);
  });

  it('carries the three floor guarantees', () => {
    expect(text()).toMatch(/duplicate/i);
    expect(text()).toMatch(/wrong amount|incorrect amount/i);
    expect(text()).toMatch(/booking token|token/i);
  });

  it('describes the aggregator without naming it', () => {
    expect(text()).toContain(PAYMENT_PARTNER.descriptor);
    expect(text()).not.toContain(PAYMENT_PARTNER.name);
    expect(text()).not.toContain('Razorpay');
  });

  it('scopes itself explicitly out of hostel-to-resident money, as RentOk does', () => {
    expect(text()).toMatch(/security deposit/i);
    expect(text()).toMatch(/does not apply|not covered by this policy/i);
  });

  it('does not promise an end-to-end refund date it cannot control', () => {
    expect(text()).toMatch(/bank|card issuer|UPI/i);
  });

  it('does not repeat the retired 7-to-10-business-day promise', () => {
    expect(text()).not.toMatch(/7 to 10 business days/i);
  });

  it('separates subscription money from resident money', () => {
    const ids = refundsDocument.content.filter((b) => b.type === 'subheading').map((b: any) => b.id);
    expect(ids).toContain('money-you-pay-stayo');
    expect(ids).toContain('money-you-pay-a-hostel');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/content/legal/refunds.test.ts`
Expected: FAIL — cannot resolve `./refunds`.

- [ ] **Step 3: Write `refunds.ts`**

Two clearly-labelled parts:

**Part 1 — Money you pay Stayo** (`subheading` id `money-you-pay-stayo`): what the subscription buys; the trial; billing cycle and autopay; refundability on mid-cycle cancellation; what happens to data and access on cancellation; fees exclusive of taxes, no GSTIN claimed.

**Part 2 — Money you pay a hostel through Stayo** (`subheading` id `money-you-pay-a-hostel`):

- Open with a `notice` block stating plainly that Stayo **neither receives nor refunds** this money: it settles directly to the hostel's own merchant account held with `PAYMENT_PARTNER.descriptor`, and the hostel issues any refund from that account. **Use `descriptor`, never `name`.**
- **Scope the policy out of hostel money in one explicit sentence**, following RentOk's clean formulation (spec §2.2): this policy does not apply to rent, security deposit, maintenance charges, utility payments or any other amount collected between a hostel and its residents — those are governed by the hostel's own terms.
- **The platform minimum floor**, as an `ordered` `list` — a condition of listing, binding on every hostel: duplicate payments, failed-but-debited transactions and wrong-amount charges are always corrected; a booking token is refunded in full if the hostel cancels or the room materially differs from the listing.
- **How the floor is enforced** — Stayo cannot pay a refund it never received; its remedies are **suspension and delisting**, escalation through the grievance channel, and raising genuine gateway-level failures such as a double capture with the payment partner. Say this plainly rather than letting residents infer Stayo will pay.
- **Beyond the floor** — the hostel's own terms govern and are shown before payment.
- **Turnaround — commit only to what is controllable** (spec §6.4): state a firm window for the hostel approving and initiating the refund on the platform, then say plainly that the money reaching the payer's account follows the timelines of their bank, card issuer or UPI provider, which no party here controls. Do **not** promise an end-to-end date; that is what made the retired "7 to 10 business days" clause indefensible.
- **How to raise a payment problem** — `contact_list` pointing at `support@yourstayo.com` first and `grievance@yourstayo.com` on escalation.

Metadata: `version: '1.0'`, `effectiveDate: '2026-09-10'`, `audience: 'all'`, `material: true`.

- [ ] **Step 4: Register it**

In `index.ts`, import `refundsDocument` and append it to `legalDocuments`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/content/legal/`
Expected: PASS — refunds tests plus the registry invariants across three documents.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/content/legal/
git commit -m "feat(legal): payments and refunds under the sub-merchant model

Separates subscription money, which Stayo receives, from resident money,
which it never touches. Resident payments settle directly to the
hostel's own merchant account, so the platform refund floor is a
condition of listing enforced by suspension and delisting rather than a
guarantee Stayo could not fund.

Drops the 7-to-10-business-day promise the system never implemented."
```

---

### Task 6: Cookie Notice and Service Delivery

Two short documents, committed together: both are single-purpose, both exist largely to satisfy a reviewer checklist, and a reviewer weighing one would weigh the other the same way.

**Files:**
- Create: `apps/frontend/src/content/legal/cookies.ts`
- Create: `apps/frontend/src/content/legal/serviceDelivery.ts`
- Modify: `apps/frontend/src/content/legal/index.ts`
- Test: `apps/frontend/src/content/legal/cookies.test.ts`

**Interfaces:**
- Consumes: `LegalDocument` (Task 2).
- Produces: `cookiesDocument`, `serviceDeliveryDocument`, both appended to `legalDocuments`.

**Content source:** spec §6.6 (cookies) and §5 (service delivery).

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/content/legal/cookies.test.ts
import { describe, expect, it } from 'vitest';
import { cookiesDocument } from './cookies';
import { serviceDeliveryDocument } from './serviceDelivery';

describe('the Cookie Notice', () => {
  it('exists, closing the footer link that previously pointed at the privacy page', () => {
    expect(cookiesDocument.route).toBe('/legal/cookies');
  });

  it('states the cookies are strictly necessary, which is why no consent banner is shown', () => {
    expect(JSON.stringify(cookiesDocument.content)).toMatch(/strictly necessary|essential/i);
  });

  it('claims no analytics or advertising cookies, matching the verified absence of any', () => {
    expect(JSON.stringify(cookiesDocument.content)).not.toMatch(/Google Analytics|advertising cookies we set/i);
  });
});

describe('the Service Delivery policy', () => {
  it('keeps the shipping-policy URLs alive for aggregator checklists', () => {
    expect(serviceDeliveryDocument.route).toBe('/legal/service-delivery');
    expect(serviceDeliveryDocument.aliases).toEqual(
      expect.arrayContaining(['/shipping-policy', '/legal/shipping-policy']),
    );
  });

  it('states that no physical goods are shipped', () => {
    expect(JSON.stringify(serviceDeliveryDocument.content)).toMatch(/no physical (goods|products)/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/content/legal/cookies.test.ts`
Expected: FAIL — cannot resolve `./cookies`.

- [ ] **Step 3: Write `cookies.ts`**

Content per spec §6.6: what a cookie is, in one plain sentence; a `table` with columns `['Cookie', 'Purpose', 'Essential?']` covering the authentication/session cookie and any theme or preference storage; an explicit statement that **Stayo sets no analytics, advertising or behavioural-tracking cookies**; why there is therefore **no consent banner** — strictly-necessary cookies require notice, not consent, and a banner asking permission for cookies that cannot be declined would be theatre; how to control cookies in the browser, with the consequence that disabling them prevents signing in.

Metadata: `version: '1.0'`, `effectiveDate: '2026-09-10'`, `audience: 'all'`, `material: false`.

- [ ] **Step 4: Write `serviceDelivery.ts`**

Content per spec §5: Stayo delivers software, not physical goods — **no physical products are shipped**; what is delivered digitally and when (account access on activation; receipts, agreements and confirmations generated in-app and by email); that access to a hostel's physical amenities is provided by the hostel, not Stayo, following its own onboarding; the support route if something is not delivered.

Metadata: `version: '1.0'`, `effectiveDate: '2026-09-10'`, `audience: 'all'`, `material: false`.

- [ ] **Step 5: Register both**

In `index.ts`, import and append `cookiesDocument` then `serviceDeliveryDocument`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/content/legal/`
Expected: PASS — five documents now satisfy the registry invariants.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/content/legal/
git commit -m "feat(legal): cookie notice and service delivery policy

The footer has linked a Cookie Policy that never existed, pointing at
the privacy page instead. This writes it, and records why there is no
consent banner: the only cookie set is the auth cookie, and asking
permission for a cookie that cannot be declined is theatre.

Service Delivery replaces Shipping & Delivery while keeping the
/shipping-policy URLs aggregator checklists look for."
```

---

### Task 7: Data Deletion & Retention, and Contact & Grievance Redressal

**Files:**
- Create: `apps/frontend/src/content/legal/dataDeletion.ts`
- Create: `apps/frontend/src/content/legal/contact.ts`
- Modify: `apps/frontend/src/content/legal/index.ts`
- Test: `apps/frontend/src/content/legal/dataDeletion.test.ts`

**Interfaces:**
- Consumes: `LegalDocument` (Task 2), `COMPANY`, `formatPostalAddress` (Task 1).
- Produces: `dataDeletionDocument`, `contactDocument`, both appended to `legalDocuments`.

**Content source:** spec §5 and §9.1. The Contact *page* rebuild is Phase 3; this task writes the **document** that the page will render.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/content/legal/dataDeletion.test.ts
import { describe, expect, it } from 'vitest';
import { dataDeletionDocument } from './dataDeletion';
import { contactDocument } from './contact';

describe('Data Deletion & Retention', () => {
  const text = () => JSON.stringify(dataDeletionDocument.content);

  it('describes closure as anonymisation, matching account-closure-service', () => {
    expect(text()).toMatch(/anonymis/i);
  });

  it('drops the 30-business-day claim — closure is immediate', () => {
    expect(text()).not.toMatch(/30 business days/i);
  });

  it('names the three blockers the backend actually enforces', () => {
    expect(text()).toMatch(/outstanding|owing/i);
    expect(text()).toMatch(/move.?out/i);
    expect(text()).toMatch(/live tenancy|still live/i);
  });

  it('explains why financial records survive', () => {
    expect(text()).toMatch(/ledger|financial record/i);
  });
});

describe('Contact & Grievance Redressal', () => {
  const text = () => JSON.stringify(contactDocument.content);

  it('publishes the entity block the e-commerce rules require', () => {
    expect(text()).toContain('Chidiri Shiva Prakash');
    expect(text()).toContain('Telangana');
  });

  it('publishes only the four serviced addresses', () => {
    for (const addr of ['support@', 'grievance@', 'privacy@', 'contact@']) {
      expect(text()).toContain(addr);
    }
    for (const unpublished of ['billing@', 'sales@', 'careers@', 'admin@', 'spchidiri']) {
      expect(text()).not.toContain(unpublished);
    }
  });

  it('states the acknowledgement and resolution windows', () => {
    expect(text()).toMatch(/48 hours|24 hours/);
    expect(text()).toMatch(/15 days|30 days|one month/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/content/legal/dataDeletion.test.ts`
Expected: FAIL — cannot resolve `./dataDeletion`.

- [ ] **Step 3: Write `dataDeletion.ts`**

Content must match `src/services/profile/account-closure-service.ts` exactly:

- **How to close your account** — self-service, in the app.
- **What happens** — the profile is **anonymised, not deleted**: name, phone, email, photo and free-text fields are replaced, the account is deactivated, the authentication user is deleted and existing sessions are revoked. Effective immediately, not after 30 days.
- **Why the row survives** — obligations, payments, agreements and a hostel's books reference it; deleting it would cascade through a third party's accounting. State the reason; it is the honest one.
- **What must happen first** — the three blockers, in the order the backend enforces them: outstanding dues, a move-out still settling, a live tenancy. Note that these are not retention devices.
- **What is retained and for how long** — financial and tax records, per law.
- **Assisted deletion** — `privacy@yourstayo.com` with what to include.

Metadata: `version: '1.0'`, `effectiveDate: '2026-09-10'`, route `/legal/data-deletion`, no aliases, `material: true`.

- [ ] **Step 4: Write `contact.ts`**

Per spec §9.1:

- **Who we are** — `contact_list` with legal entity, constitution, proprietor, registered address via `formatPostalAddress`, and `contact@yourstayo.com`.
- **Getting help** — `support@yourstayo.com` first, with the agreed first-response window.
- **Grievance redressal** — the Grievance Officer by name and `grievance@yourstayo.com`; a `table` of the acknowledgement and resolution windows (24 hours / 15 days under the IT Rules; 48 hours / one month under the Consumer Protection E-Commerce Rules); how to escalate.
- **What escalation changes** — state honestly that raising a matter to the Grievance Officer starts a formal clock and creates a record. **Do not imply a separate support department exists.**
- **Data rights** — `privacy@yourstayo.com`.
- **Hostel-specific problems** — direct these to the hostel through the app, since Stayo is not a party to the stay.

Metadata: `version: '1.0'`, `effectiveDate: '2026-09-10'`, route `/contact`, alias `/legal/contact`, `material: false`.

- [ ] **Step 5: Register both**

In `index.ts`, import and append `dataDeletionDocument` then `contactDocument`. The registry now holds all seven.

- [ ] **Step 6: Run the whole suite to verify it passes**

Run: `npx vitest run src/content/legal/`
Expected: PASS — all seven documents satisfy the registry invariants.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/content/legal/
git commit -m "feat(legal): data deletion and contact/grievance documents

Data Deletion now describes what closure actually does - immediate
anonymisation with financial records surviving - rather than promising
erasure within 30 business days that the service never performed.

Contact publishes the entity block and Grievance Officer the e-commerce
and IT Rules require, with the real acknowledgement windows, and does
not imply a support department a two-person team does not have."
```

---

### Task 8: Render the extended block vocabulary

**Files:**
- Modify: `apps/frontend/src/app/pages/LegalPage.tsx`
- Delete: `apps/frontend/src/content/legal.ts`

**Interfaces:**
- Consumes: `legalDocuments`, `LegalBlock`, `documentIdForPath`, `documentAnchors` (Tasks 2–7).
- Produces: a `LegalPage` rendering any `LegalBlock` with no `any`. Task 9 wires its routes.

- [ ] **Step 1: Replace the content import and the path resolution**

In `LegalPage.tsx`:
- Replace `import { legalSections } from '../../content/legal'` with `import { legalDocuments, documentIdForPath, documentAnchors } from '@/content/legal'`.
- Delete the hand-written `if (pathname === ...)` chain and derive the active document from `documentIdForPath(pathname, legalDocuments)`; `isHub` becomes `pathname === '/legal'`.
- Build `hubCards` from `legalDocuments` (title, `metaDescription`, `route`, `effectiveDate`) instead of the hard-coded array — the current array duplicates titles and "Updated June 2026" strings that must not drift from the registry.
- Read version and effective date for the badge from the document, replacing the hard-coded `lastUpdated`.

- [ ] **Step 2: Make the block renderer exhaustive**

Replace the `switch (block.type)` over `block: any` with a switch over `LegalBlock` that has **no `default` returning a paragraph**. Add cases for `clause` (rendering `block.number` and `id` as a deep-link anchor), `list` (`ol`/`ul` on `block.ordered`), `definitions` (`dl`), and `table` (wrapped in an `overflow-x-auto` container so wide tables scroll rather than breaking the page on mobile). Give `subheading` and `clause` `id={block.id}` with `scroll-mt-24` so anchor links clear the sticky nav.

End the switch with an exhaustiveness guard so a future block type is a compile error rather than a silently dropped section:

```tsx
default: {
  const exhaustive: never = block;
  return exhaustive;
}
```

- [ ] **Step 3: Render the "In short" summary**

Above the document body, render `document.summary` as a card, labelled so it cannot be mistaken for the terms — e.g. a heading of "In short" and a line stating this summary is provided for convenience and does not replace the full text below.

- [ ] **Step 4: Delete the superseded content file**

```bash
git rm apps/frontend/src/content/legal.ts
```

- [ ] **Step 5: Verify the build and the suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all pass. `npm run build` also runs `check-architecture.mjs` and the branding check.

- [ ] **Step 6: Commit**

```bash
git add -A apps/frontend/src
git commit -m "refactor(legal): render the typed block vocabulary

LegalPage rendered blocks as \`any\` through a switch whose default
turned anything unrecognised into a paragraph, so a mistyped block
failed silently. The switch is now exhaustive over LegalBlock and a new
block type is a compile error.

Hub cards, titles and dates derive from the registry rather than a
parallel hard-coded array that had already drifted."
```

---

### Task 9: Routes and aliases

**Files:**
- Modify: `apps/frontend/src/app/router/PublicRoutes.tsx:110-121`
- Test: `apps/frontend/src/content/legal/routes.test.ts`

**Interfaces:**
- Consumes: `legalDocuments`, `allRoutes`, `documentIdForPath` (Tasks 2–7).
- Produces: every canonical route and alias resolving to `LegalPage`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/content/legal/routes.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { legalDocuments, allRoutes } from './index';

/**
 * Guards the failure this replaced: the route table and the page's own path
 * matching were edited separately, so a route could exist with nothing
 * rendering it, or a document could declare a URL no router served.
 */
describe('public routing for legal documents', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/app/router/PublicRoutes.tsx'),
    'utf8',
  );

  it('serves every route and alias the registry declares', () => {
    for (const route of allRoutes(legalDocuments)) {
      expect(source).toContain(`path="${route}"`);
    }
  });

  it('still serves the legal hub', () => {
    expect(source).toContain('path="/legal"');
  });

  it('declares every legacy URL that was previously live', () => {
    for (const legacy of [
      '/terms', '/privacy', '/refund-policy', '/shipping-policy',
      '/legal/terms', '/legal/privacy', '/legal/refund-policy',
      '/legal/shipping-policy', '/legal/contact', '/legal/data-deletion',
    ]) {
      expect(allRoutes(legalDocuments).concat('/legal')).toContain(legacy);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/content/legal/routes.test.ts`
Expected: FAIL — `/legal/refunds`, `/legal/cookies` and `/legal/service-delivery` are not in `PublicRoutes.tsx`.

- [ ] **Step 3: Implement**

In `PublicRoutes.tsx`, replace the block at lines 110–121 with the hub route plus one `<Route>` per entry in the registry's routes and aliases, all rendering `<LegalPage />`. Keep `/contact` rendering `ContactPage` — the Contact page rebuild is Phase 3, and `contactDocument` is not rendered by `LegalPage` at `/contact` yet; `/legal/contact` renders it through `LegalPage`.

List every path literally rather than mapping at runtime, so the test above can read them statically and so a missing route is a visible diff.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/content/legal/routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify each route renders**

Run: `npm run dev`, then visit `/legal`, `/legal/terms`, `/terms`, `/legal/refunds`, `/refund-policy`, `/legal/cookies`, `/shipping-policy` and `/legal/data-deletion`.
Expected: each renders its document with the correct title, version badge and "In short" card; no "Policy not found".

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/router/PublicRoutes.tsx apps/frontend/src/content/legal/routes.test.ts
git commit -m "feat(legal): serve every registry route, keeping legacy URLs alive

Adds the new canonical routes and keeps every previously live URL as an
alias, because payment aggregators and Meta may have registered them.

A test reads PublicRoutes.tsx directly and fails if the registry
declares a URL the router does not serve - the two were previously
edited by hand and could disagree silently."
```

---

### Task 10: Remove the gateway name from the live UI

Currently `PaySheet.tsx:60` renders **"Secured by Razorpay · UPI"** to every tenant — a user-facing surface naming the aggregator, which both violates the naming rule and becomes false under Easebuzz.

**Files:**
- Modify: `apps/frontend/src/features/tenant-financials/components/PaySheet.tsx:17,60`
- Modify: `apps/frontend/src/features/help-center/helpCenter.ts:329,363`
- Test: `apps/frontend/src/features/help-center/helpCenter.test.ts`

**Interfaces:**
- Consumes: `PAYMENT_PARTNER` (Task 1).
- Produces: no gateway name in rendered copy.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/features/help-center/helpCenter.test.ts`:

```ts
it('routes an Easebuzz complaint to payments, as it already does for the old gateway', () => {
  expect(suggestCategory('easebuzz took the money twice')).toBe('PAYMENT_ISSUE');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/help-center/helpCenter.test.ts`
Expected: FAIL — `'easebuzz'` is not in the keyword lists.

- [ ] **Step 3: Implement**

1. In `helpCenter.ts`, add `'easebuzz'` alongside `'razorpay'` in both keyword arrays (lines 329 and 363). **Keep `'razorpay'`** — these are user-input matching keywords, not published copy, and a tenant may still type the old name.
2. In `PaySheet.tsx` line 60, replace `Secured by Razorpay · UPI` with copy that conveys security without naming the aggregator — e.g. `Secured payment · UPI`. Do **not** substitute `PAYMENT_PARTNER.name` here: spec §6.6 keeps general trust copy aggregator-neutral, and only the refunds document and privacy recipient list name it.
3. Update the stale comment on line 17 that describes redirecting to "the Razorpay checkout URL" to name the provider generically.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/help-center/helpCenter.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm no rendered copy names a gateway**

Run: `grep -rn -i "razorpay\|easebuzz" apps/frontend/src --include=*.tsx`
Expected: no matches in rendered JSX. Matches remaining in `.ts` keyword lists are intended and are allowlisted by Task 12.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features
git commit -m "fix(payments): stop naming the gateway in tenant-facing copy

The pay sheet rendered 'Secured by Razorpay' to every tenant, which
names the aggregator in general trust copy and becomes false under the
Easebuzz sub-merchant model.

Help-centre keyword matching keeps the old name and gains the new one:
those match what a user types, not what is published."
```

---

### Task 11: Remove superseded surfaces

Two deletions with one rationale — both publish or assert something about a business Stayo does not run.

**Files:**
- Delete: `apps/backend/app/legal/page.tsx`, `apps/backend/content/legal.ts`, `apps/backend/components/legal/LegalNav.tsx`, `apps/backend/components/legal/LegalSection.tsx`
- Modify: `apps/backend/app/api/platform-admin/revenue/export/route.ts:16,59-70`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Pure removal.

- [ ] **Step 1: Confirm nothing imports the backend legal tree**

Run (from repo root): `grep -rn "components/legal\|content/legal" apps/backend --include=*.ts --include=*.tsx | grep -v "^apps/backend/app/legal\|^apps/backend/components/legal"`
Expected: no output. If anything appears, stop and report it rather than deleting.

- [ ] **Step 2: Delete the stale backend legal tree**

```bash
git rm -r apps/backend/app/legal apps/backend/components/legal apps/backend/content/legal.ts
```

This tree publishes "Sunrise Residency" and "example-hostel.in" as live legal terms at `/legal` on the backend domain.

- [ ] **Step 3: Remove the GST report**

In `apps/backend/app/api/platform-admin/revenue/export/route.ts`: delete the `GST_RATE` constant (line 16) and the `report === "gst"` branch (lines 59–70), and remove `gst` from the accepted `report` values in the route's doc comment. Trishul Solutions is not GST-registered, so a report asserting 18% GST collected on its own revenue should not exist.

- [ ] **Step 4: Verify the backend still builds and its tests pass**

Run (from `apps/backend`): `npm run lint && npm test`
Expected: PASS. If `npm test` needs a database that is unavailable, run `npm run test:pure` and note that in the commit body.

- [ ] **Step 5: Commit**

```bash
git add -A apps/backend
git commit -m "chore(legal): delete the stale backend legal tree and the GST report

apps/backend/app/legal published 'Sunrise Residency / example-hostel.in'
as live legal terms - a divergent copy of a content file that has since
been rewritten in the frontend. Nothing imports it.

The admin revenue export generated a gst-tax-report.csv back-computing
18% GST on Stayo's own subscription invoices. Trishul Solutions is a
sole proprietorship that is not GST-registered."
```

---

### Task 12: The `check-legal.mjs` invariant

Text-level rules that must fail the build, in the style of the existing `check-brand-fossils.mjs`. Structural rules stay in the vitest tests, which can import TypeScript.

**Files:**
- Create: `apps/frontend/scripts/check-legal.mjs`
- Modify: `apps/frontend/package.json:7` (build), and add a `check:legal` script

**Interfaces:**
- Consumes: the file tree under `apps/frontend/src`.
- Produces: a build-time gate. Exits 1 with a list of failures, matching `check-architecture.mjs`'s reporting shape.

- [ ] **Step 1: Write the script**

```js
// apps/frontend/scripts/check-legal.mjs
/*
 * Fails the build on the legal-content rules that must never regress silently.
 *
 * Structural rules (every document has a version, an effective date, a summary,
 * a resolvable route) live in src/content/legal/*.test.ts, which can import the
 * registry directly. This file covers what only a text scan can see, and each
 * rule here is a mistake that has already been made in this repo once:
 *
 *  1. A gateway name in published copy. "Razorpay" was scattered through six
 *     documents and a pay sheet; the aggregator has since changed.
 *  2. An unresolved placeholder shipping to production.
 *  3. A GSTIN claimed by a proprietorship that is not GST-registered.
 *  4. Analytics appearing after the Cookie Notice asserted there is none,
 *     which would turn a true statement into a false one silently.
 *
 * Sibling of scripts/check-architecture.mjs and scripts/check-brand-fossils.mjs;
 * all three run from `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const TEXT = /\.(tsx?|jsx?|mjs|cjs|html)$/i;
const failures = [];

/**
 * Matching keywords and the constant itself — not published copy.
 * Everything else, `src/content/` above all, must describe the aggregator
 * rather than name it.
 */
const PROVIDER_NAME_ALLOWLIST = new Set([
  'src/content/company.ts',
  'src/content/company.test.ts',
  'src/content/legal/registry.test.ts',
  'src/content/legal/refunds.test.ts',
  'src/features/help-center/helpCenter.ts',
  'src/features/help-center/helpCenter.test.ts',
]);

const PROVIDERS = /\b(razorpay|easebuzz|phonepe|cashfree|paytm|payu|ccavenue|billdesk)\b/i;
const PLACEHOLDERS = /\bTBD\b|\bTODO:\s*legal\b|\[PROPRIETOR|\[ADDRESS|\[GRIEVANCE/i;
const GSTIN = /\bGSTIN\b|\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b/;
const ANALYTICS = /googletagmanager\.com|google-analytics\.com|gtag\(|posthog|mixpanel|hotjar|connect\.facebook\.net|fbq\(/i;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
    return TEXT.test(entry.name) ? [full] : [];
  });
}

const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'index.html')].filter((f) =>
  fs.existsSync(f),
);

for (const file of files) {
  const rel = path.relative(ROOT, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');

  if (!PROVIDER_NAME_ALLOWLIST.has(rel)) {
    const hit = source.match(PROVIDERS);
    if (hit) {
      failures.push(
        `${rel}: names the payment provider "${hit[0]}" — published copy must read PAYMENT_PARTNER from src/content/company.ts, and general trust copy must stay provider-neutral`,
      );
    }
  }

  if (rel.startsWith('src/content/') && PLACEHOLDERS.test(source)) {
    failures.push(`${rel}: unresolved placeholder in published legal content`);
  }

  if (GSTIN.test(source)) {
    failures.push(`${rel}: claims a GSTIN — Trishul Solutions is a sole proprietorship that is not GST-registered`);
  }

  if (ANALYTICS.test(source)) {
    failures.push(
      `${rel}: third-party analytics detected — the Cookie Notice states Stayo sets no analytics cookies and shows no consent banner. Adding analytics makes that false: update src/content/legal/cookies.ts and revisit the consent-banner decision (spec §6.6) before allowlisting this.`,
    );
  }
}

if (failures.length) {
  console.error(`Legal content check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Legal content check passed');
```

- [ ] **Step 2: Run it and confirm it passes on the current tree**

Run: `node scripts/check-legal.mjs`
Expected: `Legal content check passed`. If it fails, the failure is real — fix the source rather than widening the allowlist.

- [ ] **Step 3: Prove each rule actually fires**

Temporarily append `// Razorpay` to `src/content/legal/terms.ts`, run `node scripts/check-legal.mjs`, and confirm it exits 1 naming that file. Revert. A guard nobody has seen fail is not known to work.

- [ ] **Step 4: Wire it into the build**

In `apps/frontend/package.json`, add to `scripts`:

```json
"check:legal": "node scripts/check-legal.mjs",
```

and insert it into the `build` chain after the architecture check:

```json
"build": "node scripts/check-architecture.mjs && node scripts/check-legal.mjs && node scripts/check-brand-fossils.mjs && vite build && node ../../scripts/check-production-branding.mjs dist",
```

- [ ] **Step 5: Verify the full build**

Run: `npm run build`
Expected: the legal check prints its pass line, and the build completes.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/scripts/check-legal.mjs apps/frontend/package.json
git commit -m "feat(legal): fail the build on legal-content regressions

Guards four mistakes this repo has already made or is one edit away
from: a gateway name in published copy, an unresolved placeholder
shipping, a GSTIN claimed by an unregistered proprietorship, and
analytics appearing after the Cookie Notice asserted there is none."
```

---

### Task 13: Documentation

Required by the repository's documentation rule: a change in these categories that ships without a `docs/obsidian/` update is incomplete work, not optional follow-up.

**Files:**
- Modify: `docs/obsidian/Features.md`, `docs/obsidian/Changelog.md`, `docs/obsidian/Decisions.md`, `docs/obsidian/Business-Rules.md`, `docs/obsidian/Frontend.md`, `docs/obsidian/Bugs.md`

**Interfaces:**
- Consumes: everything Tasks 1–12 built.
- Produces: nothing code-facing.

- [ ] **Step 1: Add the ADR**

In `docs/obsidian/Decisions.md`, add an ADR recording spec decisions D1–D6 as one architectural decision: Stayo as a pure technology platform under the Easebuzz sub-merchant model; published entity minimum; terms as shared core plus schedules; the refund floor as an owner obligation enforced by suspension; the aggregator named from one constant; and versioned policies with an acceptance record (noting the record itself is Phase 4). State the context, the decision, and the consequences — including that the owner-payout subsystem now models a superseded business. Link `[[Business-Rules]]`, `[[Features]]` and `[[Frontend]]`.

- [ ] **Step 2: Update Business-Rules**

In `docs/obsidian/Business-Rules.md`, add a section covering: the platform refund floor and that it is enforced by suspension and delisting rather than by Stayo paying; 18+ eligibility with a guardian holding a minor's account; that resident payments settle directly to the owner's sub-merchant account and Stayo is never in the flow of funds; and that Stayo takes no share of transaction fees.

Also add a note to the existing "Owner payouts" section recording that it describes the pre-sub-merchant model and is superseded — do not delete it, since the code still exists.

- [ ] **Step 3: Update Features, Frontend and Changelog**

- `Features.md`: the legal document set, its routes and aliases, and the invariant script.
- `Frontend.md`: `src/content/legal/` as the typed registry, the block union, and that route resolution is a pure tested function.
- `Changelog.md`: a dated entry summarising Phase 1 and linking `[[Decisions]]`.

- [ ] **Step 4: Record the corrected misrepresentations in Bugs**

In `docs/obsidian/Bugs.md`, record the four policy-vs-reality mismatches from spec §4 as a single entry — the refund SLA the system never implemented, the deletion promise that contradicted anonymise-not-erase, the blanket non-refundable rent claim, and the footer's link to a non-existent Cookie Policy — plus the live "Secured by Razorpay" pay-sheet string. These revealed a real design gap: published copy had no test, no owner and no invariant, which is what Task 12 fixes.

- [ ] **Step 5: Commit**

```bash
git add docs/obsidian
git commit -m "docs(obsidian): record the Phase 1 legal policy set

Adds the ADR for the sub-merchant platform position, the new business
rules (refund floor, 18+ eligibility, direct settlement), and marks the
owner-payouts section as describing a superseded model.

Records the four policy-vs-reality mismatches this phase corrected."
```

---

## Phase 1 completion check

Run from `apps/frontend`:

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

Then from `apps/backend`:

```bash
npm run lint && npm test
```

All must pass before Phase 1 is considered done. Do not claim completion without the output in hand.

## What Phase 1 deliberately does not do

- **The legal hub redesign** — document rail, sticky table of contents, print stylesheet, unified footer, in-app rows for owner and tenant, contextual links. Phase 2.
- **The grievance intake** — `platform_support_tickets` extended to unauthenticated submissions, and the Contact page rebuilt onto it. Phase 3. Until then `/contact` keeps its existing `mailto:` form, and `contactDocument` publishes the required entity and Grievance Officer details.
- **Consent capture and versioning tables.** Phase 4.
- **The Easebuzz integration itself** — a go-live blocker tracked in spec §13, not code this phase writes.
- **Audience filtering of the schedules** — the data carries `audience`; the reader-side filter is Phase 2.
