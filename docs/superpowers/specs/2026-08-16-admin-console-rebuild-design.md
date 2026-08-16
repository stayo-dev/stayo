# Admin Console Rebuild — Design

**Date:** 2026-08-16
**Status:** Awaiting review
**Source design:** Claude Design project `3f2fbde6-3b8f-48cb-969d-b32ea4fda42d`, file `Stayo Admin.dc.html`

## Goal

Replace the existing platform-admin console entirely with the new `Stayo Admin.dc.html`
design, and wire it to the real Stayo workflow — lead generation, KYC, hostel listing
approval, and the owner lifecycle — rather than to the design's mock data.

Two sections (Settlements, Reports & Bugs) are deliberately front-end only: their
backends are not yet designed.

## Context: what the source design is

`Stayo Admin.dc.html` is a prototype rendered by `support.js`, a generated `dc-runtime`
implementing a small template DSL (`<x-dc>`, `sc-if`, `sc-for`, `{{ }}`). It is not
React and is not a component library — it is a single 1,697-line file with all state in
one `DCLogic` class and all data hardcoded. It is a **visual and behavioural
specification**, not code to import.

It defines:

- A sidebar console: 10 nav items in 4 groups (Manage / Review / Business / Support).
- A topbar: page title + subtitle, global search, date-range control, notification bell.
- 10 content sections, three of which have internal tabs.
- A right-side detail drawer with 6 variants and its own per-variant footer actions.
- A toast system.

## Decisions taken

| # | Decision | Choice |
|---|---|---|
| 1 | Screens whose backend doesn't exist | Build the UI, render honest "not wired yet" states. Never mock numbers. |
| 2 | Settings (absent from the design, exists today) | Keep, as an extra nav item in the Support group. |
| 3 | Marketing reviews (ADR-076, absent from the design) | Fold in as a "Content review" tab inside Hostel Listings. |
| 4 | Styling | Tailwind with the design's exact hex palette. Not verbatim inline styles. |
| 5 | Lead lifecycle | One enum, split ownership: admin-driven front half, system-driven back half. |
| 6 | KYC depth | Add GST / property / bank-proof doc types + business details. Defer payout bank fields to settlements. |
| 7 | Lead insights | Build the full lead-CRM tables (activities, notes, structured lost reasons, discovery). |
| 8 | 14-day trial | Surface it across the console, and set `trial_ends_at` at activation. |

## The owner lifecycle (the core model)

The design ships a *sales* funnel. The codebase implements an *activation* funnel. They
are not competing models — they are the front and back halves of one journey. This spec
merges them into a single ordered `PlatformLeadStatus`.

```
ADMIN-DRIVEN  (manually settable; no side effects)
  NEW → CONTACTED → DEMO → NEGOTIATING
                              │  admin approves
                              ▼
SYSTEM-DRIVEN (set only by services; each has real side effects)
  APPROVED → INVITE_SENT → OWNER_ACTIVATED → HOSTEL_CREATED → LIVE
                                                                │
                                                    14-day trial │
                                                                ▼
                                                     subscription (model TBD)

  LOST ← reachable from any admin-driven stage, with a structured reason
```

### Why this shape is safe

The split is **already how the code works** — it is not a new invention.
`app/api/platform-admin/leads/[id]/route.ts` defines
`MANUALLY_SETTABLE_STATUSES = ["NEW", "UNDER_REVIEW", "LOST"]`, and its comment records
that this array — not UI convention — is what guarantees no manual status edits after an
invite is sent. `APPROVED` onward is written only by
`src/services/platform-leads/lead-invitation-service.ts` and the auto-progression choke
points in owner-signup and owner-hostels.

The change is therefore narrow:

- Add `CONTACTED`, `DEMO`, `NEGOTIATING` to the enum.
- Extend `MANUALLY_SETTABLE_STATUSES` to `["NEW", "CONTACTED", "DEMO", "NEGOTIATING", "LOST"]`.
- Migrate existing `UNDER_REVIEW` rows to `CONTACTED`, and retire `UNDER_REVIEW`.

### Trap: the stage mapper is public-facing

`src/services/platform-leads/lead-stage-mapper.ts` is **not** an internal display helper.
It drives the public `/enquiry/:token` page that a prospective owner sees, and its module
comment states it exists so internal vocabulary "can never reach an applicant."

Adding the new stages without touching it would show a prospect a page reading
**"Negotiating"** or **"Demo"**. All three new statuses must collapse into the existing
`under_review` bucket, whose applicant-facing label stays **"Under review"**.

This is a required, tested part of the change, not a follow-up.

- `APPROVABLE_STATUSES` in `lead-invitation-service.ts` must also accept the new stages,
  so a lead can be approved directly from `NEGOTIATING`.

## Backend changes

### Schema

```
enum PlatformLeadStatus
  + CONTACTED, DEMO, NEGOTIATING      (UNDER_REVIEW retired after data migration)

enum PlatformLeadLostReason           (new — structured, aggregatable)
  PRICE, WENT_WITH_COMPETITOR, NOT_READY, NO_RESPONSE,
  MISSING_FEATURE, TOO_SMALL, OTHER

model platform_leads                  (new columns)
  lost_reason         PlatformLeadLostReason?
  lost_note           String?
  discovery_problem   String?         // "what's broken today"
  discovery_why       String?         // "why Stayo"
  discovery_expect    String?         // "what they expect"
  qual_beds           Int?            // captured on the qualifying call
  qual_rooms          Int?
  qual_occupancy_pct  Int?
  qual_monthly_revenue Decimal?
  qual_branches       String?         // free text: "2 · Delhi, Gurgaon"

model platform_lead_activities        (new — the outreach log)
  id, lead_id, type (CALL|EMAIL|WHATSAPP|NOTE), outcome, actor_id, created_at

model platform_lead_notes             (new — the notes thread)
  id, lead_id, body, author_id, created_at

model owner_kyc_profiles              (new — business details behind KYC)
  id, profile_id, legal_business_name, gstin, business_address,
  status, submitted_at, reviewed_at, reviewed_by, review_note

owner_documents.doc_type              (string column — no enum migration needed)
  + GST_CERTIFICATE, PROPERTY_PROOF, BANK_PROOF
```

`platform_leads.pain_point` and `current_tooling` are kept and backfilled into
`discovery_problem` / nothing respectively. Their schema comment warns they are
free-form and unsafe to aggregate — that warning is *why* `lost_reason` is a real enum,
and the insight charts aggregate only the enum.

**Deferred by decision 6:** the structured payout fields `payout_account_no`,
`payout_ifsc`, `payout_holder_name`. They belong with the settlements backend. Capturing
and "verifying" a payout account that nothing pays out to invites the two to drift apart
before settlements is designed.

Note this is deliberately *not* the same as the `BANK_PROOF` document type above. A
bank-proof image is identity evidence an admin eyeballs during KYC, like the PAN card.
Structured account/IFSC fields are transfer instructions a payout system would execute
against. The first is in scope; the second waits.

### Notable existing behaviour to preserve

- Lead events are logged to `systemEventLog` with `lead_id` inside `metadata` (there is
  no `lead_id` column — a deliberate reuse tradeoff recorded in Decisions.md). The new
  `platform_lead_activities` table does **not** replace this; `systemEventLog` remains
  the audit trail, while `platform_lead_activities` is the human-authored outreach log
  an admin fills in during a call. The drawer timeline merges both, newest first.
- `POST /leads/[id]/approve` advances to `INVITE_SENT` **only on a successful send**.
  Unchanged.

### Endpoints

New:

| Method | Path | Purpose |
|---|---|---|
| POST | `/platform-admin/leads/[id]/activities` | Log an outreach attempt |
| GET/POST | `/platform-admin/leads/[id]/notes` | Notes thread |
| PATCH | `/platform-admin/leads/[id]/qualification` | Qualify + discovery fields |
| POST | `/platform-admin/leads/[id]/lost` | Structured lost reason + note |
| GET | `/platform-admin/leads/insights` | Aggregates for the Insights tab |
| GET/PATCH | `/platform-admin/owners/[id]/kyc` | Business details + review |
| GET | `/platform-admin/trials` | Trials ending soon |

Changed:

- `PATCH /platform-admin/leads/[id]` — widened `MANUALLY_SETTABLE_STATUSES`.
- `POST /platform-admin/owner-documents/[id]/review` — accepts the new doc types.
- Hostel activation — sets `trial_ends_at = now + 14 days` (the same 14-day constant
  already hardcoded at `hostels/[id]/subscription/route.ts:55`; it must be extracted to
  one shared constant rather than duplicated).

**Not built:** settlement endpoints, report/bug endpoints. Out of scope by decision 1.

## Frontend architecture

### Deleted

All 9 pages under `apps/frontend/src/platforms/admin/pages/` and
`apps/frontend/src/app/layouts/AdminAppShell.tsx` — roughly 3,400 LOC.

### Kept

- **Auth spine, untouched:** `AdminProviderShell`, `RequireAdminSession`,
  `useAdminSession`. The design changes no auth behaviour.
- **API layer, extended not rewritten:** `features/platform-admin/api/index.ts`. Per
  `check-architecture.mjs` this is the only layer allowed to know endpoint shapes.
- **Tested pure logic, re-pointed:** `leadQueue.ts`, `needsAttention.ts`,
  `ownerHealth.ts`, `revenueFormat.ts`, `documentQueue.ts`. These carry real,
  test-covered business rules; deleting them to re-derive them worse is the one
  genuinely wasteful move available in a rebuild. Any module the new design orphans is
  deleted together with its test — not left behind.

### New structure

```
src/platforms/admin/
  layout/AdminConsoleShell.tsx    sidebar + topbar + drawer host + toast host
  layout/adminNav.ts              nav groups, icons, badge counts — one source of truth
  theme/palette.ts                the design's exact hex constants
  ui/                             StatCard, DataTable, SegmentedTabs, FilterChips,
                                  EmptyState, NotWiredYet, DrawerSection, KeyValueRows
  drawer/AdminDrawer.tsx          + LeadDrawer, OwnerDrawer, KycDrawer, ListingDrawer,
                                    ClientSummaryDrawer, SettlementDrawer
  pages/                          11 pages
  <domain>/*.ts + *.test.ts       pure logic under vitest
```

`apps/frontend` **does** have a working vitest setup (`vitest.config.ts`, `npm test`).
The root `CLAUDE.md` claims otherwise and is stale on this point; it should be corrected
as part of this work.

Manrope and Inter are already loaded in `index.html` — the design's two fonts need no
new loading.

### Routes

`/admin` · `/leads` · `/owners` · `/kyc` · `/listings` · `/revenue` · `/settlements` ·
`/subscriptions` · `/reports` · `/broadcasts` · `/settings`

Redirects so no existing link rots: `documents → kyc`, `hostels → listings`,
`marketing-reviews → listings?tab=content`, `more → settings`.

### Drawer state lives in the URL

`?detail=lead:<uuid>`, not component state. An admin can send a colleague a link to a
specific KYC submission, and refreshing mid-review does not lose their place.

## Screen-by-screen data mapping

| Screen | Source | Treatment |
|---|---|---|
| Overview KPIs | `/platform-admin/dashboard` → `kpis` | Real |
| Overview revenue bars / funnel | — | No date-series endpoint exists → card renders, series empty-stated |
| Overview review queue | lead counts + pending docs + pending listings | Real |
| Leads · Pipeline | `/leads` + `counts` | Real, using merged stages |
| Leads · Insights | `/leads/insights` | Real once tables land; `lost_reason` enum drives both charts |
| Owners | `/platform-admin/owners` | Real — already returns hostels, beds, GMV, plan, status |
| KYC | `/owner-documents` + `/owners/[id]/kyc` | Real; automated-check panel is empty-stated (no verification provider integrated) |
| Listings | `/platform-admin/hostels` + approve/reject-listing | Real; Content review tab → `/marketing-reviews` |
| Revenue | `/platform-admin/revenue` | KPIs real. Daily calendar heatmap + top-earning hostels have no endpoint → empty-stated |
| Subscriptions | `/platform-admin/plans` | Real, plus trial visibility |
| Broadcasts | `/platform-admin/broadcast` | Real |
| Settlements | — | **All three tabs empty-stated.** `/api/admin/settlements/*` currently return 410 Gone |
| Reports & Bugs | — | **No model.** Layout ships, list empty |
| Settings | admins / templates / settings | Real |

## The rule that keeps this honest

One `<NotWiredYet>` component, one wording pattern, everywhere data does not exist:

> **Settlement runs aren't live yet** — the payout backend is still being designed.
> This screen is ready for it.

Never a plausible-looking zero. Never a mock row. An admin must never be able to mistake
an unbuilt screen for a real one reporting that business is quiet — that is the failure
mode that makes a rebuilt console actively dangerous rather than merely incomplete. This
applies equally to the Settlements kanban, the Reports list, the revenue calendar, and
the KYC automated-checks panel.

## Non-goals

- Settlement backend, payout execution, UTR capture, audit log persistence.
- Reports/bugs backend.
- Subscription billing, pricing, or charging. The business model is undecided; the trial
  is surfaced as lifecycle state only.
- Payout bank details on the KYC record.
- Call-recording upload. The design shows it; there is no audio storage story and
  ImageKit is configured for images/documents. Deferred, and the panel is empty-stated.
- Any change to auth, session handling, or the tenant/owner apps.

## Verification

- `apps/frontend`: `npm run check:architecture`, `npm run typecheck`, `npm test`,
  `npm run build`.
- `apps/backend`: `npm test`, plus `check:invariants` — the invariant script forbids
  treating `hostelId` as optional and forbids `hostels[0]` fallbacks, both of which are
  easy to reintroduce in an owner-centric console.
- New pure modules (stage mapping, insight aggregation, trial countdown, lifecycle
  guards) are written test-first.
- Specific regression to cover: the public `/enquiry/:token` page must still render
  "Under review" for a lead sitting in `DEMO` or `NEGOTIATING`.

## Sequencing

1. **Backend — lifecycle.** Enum, migration, mapper fix, widened settable statuses, tests.
2. **Backend — lead CRM + KYC.** New tables, endpoints, tests.
3. **Frontend — shell.** `AdminConsoleShell`, nav, drawer host, toast, palette, routes,
   redirects. Old pages deleted here.
4. **Screens with full real data.** Owners, Listings (+ Content review), KYC. Usable console.
5. **Leads.** Pipeline + Insights + the six-section lead drawer. The priority screen.
6. **Overview, Revenue, Subscriptions, Broadcasts, Settings.**
7. **Settlements + Reports & Bugs.** Layout only, empty-stated.
8. **Docs.** `docs/obsidian/` Features, Frontend, Backend, Database, APIs, Business-Rules,
   Decisions (ADRs for the lifecycle merge and the console replacement), Changelog; plus
   the stale `CLAUDE.md` vitest claim and ADR-076's marketing-review location.

Steps 1–4 leave the console in a working, shippable state; the rebuild is not
all-or-nothing.

## Risks

- **Enum migration on a live table.** `platform_leads.status` is indexed and read by
  several services. The `UNDER_REVIEW → CONTACTED` migration must run before the enum
  value is retired, in two steps, not one.
- **Deleting tested logic.** Mitigated by the "kept on merit" list; anything dropped is
  dropped with its test and noted in the changelog.
- **Scope.** 11 screens + 6 drawer variants + backend work. The sequencing above exists
  so this can stop at a working state at several points.

## Open questions

- Whether Reports & Bugs should eventually ingest from an existing channel (WhatsApp bot,
  support email) rather than a new in-app report form. Not needed for this work — the
  screen is layout-only — but it decides the schema when the backend is designed.
