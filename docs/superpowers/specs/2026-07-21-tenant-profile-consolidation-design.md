# Tenant Profile (Owner Side) — UI/UX Consolidation Design

## Goal

The owner-facing Tenant Profile page (`frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`) has accreted redundant sections and false-affordance navigation since its 2026-07-16 financial redesign. This is a **pure UI-layer consolidation**: reduce what's on screen and remove duplicated data/actions, without changing any backend business logic, calculations, or API contracts.

## Problems being fixed (grounded in current code)

1. **`FinancialWorkspaceNav` looks like tabs but isn't one.** It's a sticky row of buttons (`Summary | Actions | Obligations | Activity | Ledger | Documents`) that calls `scrollIntoView` — every section renders simultaneously below it. Clicking a nav item just jumps scroll position on an already-fully-rendered, very long page.
2. **Three components independently render overlapping payment/ledger/activity data**, each with its own, different filter-chip taxonomy:
   - `FinancialActivity` (chips: All/Payments/Charges/Waivers/Credit/Agreement) — consumes the already-composed `financial-timeline-service` events (payments, obligations, ledger credits/debits, change requests).
   - `LedgerStatement` (chips: All/Payments/Future Credit/Waivers/Adjustments/Deposits) — renders the **same underlying ledger rows** (`tenant_financial_ledger`) that `FinancialActivity`'s "Credit" filter already surfaces, in a day-grouped accounting-statement form with a running `balance_after`.
   - `ActivityTimeline` ("Recent Activity", chips: All/Payments/Room & Stay/KYC Docs/Contact Logs/System Logs) — independently re-derives payment events from the same `recentPayments` prop (`"Payment Confirmed... via Cash"`), duplicating what `FinancialActivity` already shows, alongside genuinely non-duplicated KYC/room/system/comms events.
   - A fourth, fully standalone "Invitation History Logs" card sits below all of this.
3. **`TenantHealthCard` and `OwnerInsights` independently derive and display the same underlying signals** (agreement status, KYC/document status, payment score) — one as a composite score + 3-icon checklist, the other as prose warnings that restate the same checklist items ("Active agreement missing", "Mandatory KYC documentation is missing").
4. **Eight action buttons are split across three disconnected groups**: "Core Action Dashboard" (Request Change, Check-out/Exit), "Primary Actions" (Receive Payment, Create Charge, Create Rent, Share Payment Link, View Receipts), and a lone floating "Change Rent" button. Mobile already solves this (single "Actions" button → bottom sheet listing all of `PrimaryActionsBar`'s actions) — desktop does not.

## Explicitly out of scope

- No change to any backend service, API route, obligation/ledger/settlement calculation, or Prisma schema.
- No change to the Agreement-status wording contradiction (header "Active Contract" vs. stat-tile "No active agreement") — confirmed out of scope by the user; these read from genuinely different fields (room allocation vs. tracked agreement duration) and are left as-is.
- No change to `Communication Center`, the header identity banner, `Private Notes`, or the conditional warning banners (pending change request, room-assignment-needed, pending billing-frequency request) — not flagged as redundant, kept as-is.
- No change to `RentObligationList` (Obligations tab content) beyond moving it into a tab instead of a static section.

## Architecture

### Always-visible zone (above the tabs) — unchanged set, two consolidations within it

Stays exactly where it is today, top to bottom:
1. Back link
2. Header identity banner (name, status, room, joined date, hostel, contract badge)
3. Pending-change-request banner (conditional)
4. Row: **Communication Center** (unchanged) + **consolidated action bar** (see below, replaces the separate "Core Action Dashboard" card)
5. Row: **Risk & Compliance card** (new, merged) + **Private Notes** (unchanged) — was a 3-card row (Health / Insights / Notes), now 2 cards
6. Room-assignment / pending-billing-request warning banners (conditional, unchanged)
7. Financial stat strip (`CompactFinancialStrip`, unchanged 6 tiles) + `FinancialHealthBanner` (recommended action / Collect Now banner, unchanged)

### Tabbed zone (below that) — new, real tabs shared by mobile and desktop

Replaces: the current `isMobile ? <Tabs>… : <static grid + static sections>` fork, plus the two collapsible cards ("KYC Verification & Documents", "Stay Details & Checkout Workflow") and the standalone "Recent Activity" / "Invitation History Logs" cards.

One `Tabs` instance, same component already used today for the mobile-only case, now used unconditionally:

| Tab | Content |
|---|---|
| **Obligations** | `RentObligationList` (unchanged) — no merge, just moved from a static section into a tab |
| **Activity** | New unified, filterable, chronological timeline (see below) — replaces `FinancialActivity` + `LedgerStatement` + `ActivityTimeline` + the Invitation History card |
| **Documents** | Merges `DocumentsHub` (Agreement/Receipts/Payment Link/Change Request sub-tabs) with the KYC identity-document checklist (`VerificationPanel` + its reminder/rules-acceptance actions), as two labeled groups: **Identity & KYC** and **Contract & Payments** |
| **Stay** | `AllocationHistoryTimeline` + `ExitWorkflowSection` (currently the collapsible "Stay Details & Checkout Workflow" card) — same content, promoted from an expandable card to a tab |

`FinancialWorkspaceNav.tsx` is deleted; its role (jumping to a section) is replaced by the tabs themselves being the navigation. The `fin-summary`/`fin-actions` anchor targets go away since Summary and Actions are no longer separately-navigable sections — they're simply always visible above the tabs.

## Component-level changes

### 1. `RiskComplianceCard` (new) — replaces `TenantHealthCard` + `OwnerInsights`

- **Deletes:** `frontend-v2/src/features/tenants/components/score/TenantHealthCard.tsx`, `frontend-v2/src/features/tenants/components/profile/OwnerInsights.tsx`
- **Creates:** `frontend-v2/src/features/tenants/components/profile/RiskComplianceCard.tsx`
- **Design:** Keep `TenantHealthCard`'s structure as the base (composite score header + level badge + level description + 3-icon checklist row: Payment Rate / Agreement / KYC Verification) — this is the single source of truth for "what's the status of these three things." Below the checklist, show `OwnerInsights`' narrative warnings, **but only the ones that add information the checklist doesn't already state**: keep the score-derived insight ("High risk of payment default…" / "Excellent payment reliability…" / "Moderate risk…") and the overdue-days and deposit-status insights; **drop** the "Active agreement missing" and "Mandatory KYC documentation is missing" narrative insights, since the checklist row directly above already shows Agreement/KYC status — restating them in prose is exactly the duplication being removed. If zero narrative insights remain (fallback case), keep `OwnerInsights`' existing fallback message ("All billing configurations and verification details are in order").
- **Props:** union of both components' current props (`score`, `grade`, `trend`, `hasAgreement`, `documentStatus`, `overdueDays`, `outstandingAmount`, `depositStatus`, `joinedDate`) — no new data dependencies, both already receive the same inputs from `TenantProfilePage.tsx`.

### 2. Unified Activity Timeline (new) — replaces `FinancialActivity` + `LedgerStatement` + `ActivityTimeline` + Invitation History

- **Deletes:** `frontend-v2/src/features/tenants/components/financial/FinancialActivity.tsx`, `frontend-v2/src/features/tenants/components/financial/LedgerStatement.tsx`, `frontend-v2/src/features/tenants/components/profile/ActivityTimeline.tsx`, and the inline "Invitation History Logs" JSX block in `TenantProfilePage.tsx`
- **Keeps and reuses:** `FinancialActivityCard.tsx` (the individual expandable payment/ledger/obligation card renderer) and `groupFinancialActivity.ts`/`financialColors.ts` (the event-grouping and color/icon vocabulary) — these become the rendering primitives for financial-type entries inside the new unified list. Do not reimplement what these already do correctly.
- **Creates:** `frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx`
- **Design:** One chronologically-sorted list combining:
  - The existing composed `financialEvents` (from `financial-timeline-service`, already merges payments/obligations/ledger/change-requests — no backend change needed) — rendered via the existing `FinancialActivityCard`, exactly as `FinancialActivity` does today, including its expand/collapse and action callbacks (download receipt, view obligation, correct payment).
  - The non-financial events `ActivityTimeline` currently derives client-side from `allocations`, `documents`, `moveOutRequest`, `notes`, and `activityListService` system logs (room/KYC/system/comms categories) — rendered via `ActivityTimeline`'s existing simpler timeline-dot style, since these are lighter-weight descriptive events without a rich expand/collapse need.
  - **Ledger entries' `balance_after`** (currently only shown in `LedgerStatement`) surfaced as an extra line in the expanded detail of `LEDGER_CREDIT`/`LEDGER_DEBIT`-type `FinancialActivityCard` entries, so no information from the deleted `LedgerStatement` is lost — just relocated into the entry that already represents that same ledger row.
  - **Invitation history** (`tenant_invitations`) converted into timeline entries (one per invitation version: Accepted/Superseded), same event-card style as the other non-financial entries.
  - **`ActivityTimeline`'s own payment-derived events are dropped entirely** (not migrated) — they were the exact duplicate of what `financialEvents`/`FinancialActivityCard` already renders; this is the specific redundancy removal, not a data loss, since the same payments remain visible via the financial-event path.
- **Filter chips (default set, adjustable during implementation if a category proves empty/unnecessary):** `All · Payments · Ledger · Obligations · Agreement · KYC · Room & Stay · System`. Consolidates the three prior taxonomies rather than concatenating them — e.g. "Charges"+"Waivers" collapse into one "Obligations" chip; "Contact Logs" folds into "System" (Communication Center already covers live contact actions; historical reminder logs don't need their own top-level chip).
- Keeps the existing "Load more" pagination behavior from `FinancialActivity` (`PAGE_SIZE = 8`) applied to the merged, sorted list.

### 3. Documents tab (new grouping) — merges `DocumentsHub` + the KYC `VerificationPanel` section

- **No component deletion** — `DocumentsHub.tsx` and `VerificationPanel.tsx` are kept as-is internally (each already has its own internal structure/sub-tabs worth preserving); what changes is that `TenantProfilePage.tsx` now renders both under one "Documents" tab instead of `DocumentsHub` living in the static financial section and `VerificationPanel` living in a separate collapsible "KYC Verification & Documents" card.
- **Creates:** a thin new wrapper, `frontend-v2/src/features/tenants/components/profile/DocumentsTab.tsx`, that renders two labeled groups — "Identity & KYC" (wraps `VerificationPanel` + the existing reminder/resend-rules/download-acceptance-JSON action row) and "Contract & Payments" (wraps the existing `DocumentsHub`, unchanged) — using a simple toggle or stacked-sections layout (implementation's call, consistent with existing patterns elsewhere in this codebase).

### 4. Stay tab — promotes the existing collapsible card, no internal change

- `AllocationHistoryTimeline` + `ExitWorkflowSection`, exactly as they render today inside the "Stay Details & Checkout Workflow" collapsible card, become the "Stay" tab's content. No new component needed — just moved from a `useState` expand/collapse pattern into a `TabsContent`.
- The existing `id="stay-details-section"` scroll-target and the Core-Action-Dashboard's "Check-out / Exit" button's `scrollIntoView` + `setIsStayExpanded(true)` behavior is replaced with: switch to the Stay tab (and scroll the tab region into view if it's below the fold).

### 5. Consolidated action bar — extends `PrimaryActionsBar`, absorbs 3 other buttons

- **Modifies:** `frontend-v2/src/features/tenants/components/financial/PrimaryActionsBar.tsx`
- **Deletes:** the "Core Action Dashboard" card block in `TenantProfilePage.tsx` (Request Change / Edit Details + Check-out/Exit buttons) and the standalone floating "Change Rent" button block — both folded into `PrimaryActionsBar`.
- **New props:** `onRequestChange` (or `onEditDetails`, whichever applies per tenant status — same conditional logic already in the current Core Action Dashboard block), `onChangeRent`, `onCheckout`, plus the existing `personalInfoAction`/`findAction('PAYMENT_RECEIVE')` label-sourcing already used today.
- **Desktop layout:** `Receive Payment` stays the single emphasized primary button. `Create Charge`, `Create Rent`, `View Receipts` remain as visible secondary buttons (today's existing three, unchanged styling). The remaining four — `Share Payment Link`, `Request Change`/`Edit Details`, `Change Rent` (only when tenant is ACTIVE, matching its current conditional), `Check-out / Exit` — move into a "More actions" overflow menu, using the existing `dropdown-menu.tsx` UI primitive (already present in this codebase, not a new dependency).
- **Mobile layout:** unchanged mechanism (single "Actions" button → bottom sheet) — just extended to include the four newly-absorbed actions in that same sheet's list.

## Data flow

No new API calls, no new query keys, no backend changes. Every value the new/merged components need is already fetched by `TenantProfilePage.tsx` today (`financialEvents`, `advance.entries`, `activityListService` system logs, `allocations`, `documents`, `tenant_invitations`, etc.) — this is a recomposition of existing data into fewer, non-duplicated visual containers, not a new data-fetching layer.

## Error handling / edge cases

- Empty states: each tab keeps its existing "no X yet" empty-state copy (Obligations, Documents, Stay already have these; the new unified timeline keeps `FinancialActivity`'s "No financial activity recorded yet." / "No events found" pattern per active filter).
- Loading states: unchanged — each tab's content still shows its own loading spinner while its underlying query is in flight (no page-level loading gate is introduced).
- The unified timeline's merge must preserve strict chronological sort across both event sources (financial events carry their own timestamps; non-financial events carry `Date` objects) — sort key is a normalized `Date`/epoch-ms for every entry regardless of source.
- Filter-chip counts: if a given category (e.g. "Agreement") has zero entries for a tenant, the chip still shows (consistent with current behavior across all three predecessor components — none of them hide empty-count chips) and its content is the standard empty state.

## Testing / verification plan

`frontend-v2` has no test suite (per `CLAUDE.md`) — verification is:
1. Code read-back of every new/modified file.
2. `npm run build` from `frontend-v2/` (runs `check:architecture`, `vite build`, branding check) — must pass clean.
3. Manual verification in a running dev server / browser for this specific tenant page: confirm the always-visible zone renders correctly, all 4 tabs load their content, the action bar's overflow menu opens and each action still triggers its existing modal/flow correctly, and the unified timeline shows financial + non-financial events interleaved and filterable — per this repo's UI-change convention ("test the feature in a browser before reporting complete"), not just a build-pass claim.

## Self-review

- **Placeholder scan:** no TBD/TODO; the one deliberately-flexible item (unified timeline's exact chip list) is called out explicitly as adjustable, not left vague by omission.
- **Internal consistency:** component deletions listed in each subsection match the "Problems being fixed" list 1:1; no section proposes keeping something another section deletes.
- **Scope:** single page, single implementation plan; no backend task, no cross-page component impact (confirmed via grep — every merged/deleted component has exactly one current consumer, this page).
- **Ambiguity check:** the one place two readings were possible — whether `ActivityTimeline`'s payment-derived events migrate into the unified timeline or are dropped — is resolved explicitly (dropped, not migrated, since they duplicate the financial-event path).
