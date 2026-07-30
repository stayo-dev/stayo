# Financial Control Center (Overview tab) redesign

Status: Approved for implementation
Date: 2026-07-18

## Context

`frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx` is the "Overview" tab of the owner-facing Money screen (`BillingDashboard.tsx` → tab `overview`; the sibling `expenses` tab renders `ExpensesTab` and is **out of scope** — it was redesigned separately and recently, see commit `8d58b4d5`).

The current Overview implementation (1329 lines) shows, top to bottom: a "Net Cash Flow" hero with an Expected/Collected/Outstanding/Expenses KPI grid and collection-rate bar, a "Collection Queue" (overdue tenants), an always-visible "Revenue Health" grid (on-time %, avg delay, reminder dependency, expense ratio), conditional "Due This Week" / "Unconfirmed Payments" cards, an "Expense Summary" block (category breakdown), a "Recent Financial Activity" feed, the full searchable `PaymentLedger` table, and a collapsible "Cashflow, Expenses & Collection Charts" block (3 chart components).

The user supplied a redesign proposal (external design doc, pasted in full into conversation) whose philosophy is: every section answers exactly one owner question, no charts, and a strict five-section flow: Collection Progress → Priority Collections (renamed from Collection Queue) → Smart Insights → Property Finance → Recent Transactions.

This spec reconciles that proposal with what's actually buildable from data already fetched by the component (no backend changes), and with functionality currently on the screen that the proposal didn't address.

## Decisions made during brainstorming

- **Implement, not just critique** — full rework of the Overview tab.
- **Month-over-month trend insight ("+8% vs June")**: dropped. No backend endpoint returns prior-month data; adding one is out of scope for what's otherwise a frontend-only change.
- **"Due This Week" / "Unconfirmed Payments" cards**: folded into Smart Insights as conditional insight lines rather than dedicated cards.
- **Header action buttons** (Record Payment, Add Expense, Remind, Export): all 4 kept as-is (`OwnerActionsBar` untouched) — these are real, recently-built features (CSV/XLSX/PDF export, per commit `e061b52a`), not decoration.
- **"Revenue Health" grid**: dropped as a standalone section; its most actionable signal(s) folded into Smart Insights.
- **Payment Ledger**: not deleted. "Recent Transactions" (last 5) is the default view; a "View All" toggle expands the existing full searchable `PaymentLedger` table beneath it, collapsed by default.
- **Property Finance**: rendered only when `hostelId === 'all'`. Hidden entirely for a single selected hostel (nothing to compare).

## Section-by-section design

### 1. Header / actions
No change. `OwnerActionsBar` stays exactly as-is.

### 2. Collection Progress (hero)
Replaces the "Net Cash Flow" card.

- Big progress bar, label = `collectionRate` (already computed: `revenue / expected_revenue`).
- Row: **Collected** (`collectedVal`) / **Pending** (`outstandingVal`, renamed from "Outstanding" to match proposal vocabulary).
- Row: **Today's Collection** (new: sum of `payments[].amount_paid` where `payment_date` falls on today's calendar date) / **Target** (`expectedVal` — deliberately the same figure as the progress bar's denominator, not a separate goal).
- Keep the existing `Cash: ₹X · UPI: ₹Y` text line (from `collectionsSplit`) underneath — it's plain text, not a chart, so it's consistent with the "no graphs" rule.
- Drop: the old "Per Tenant" figure (per brainstorming: not actionable, and not present in the new hero) and the "✓ No upcoming collections / ✓ All payments verified / ✓ No expenses recorded" badge row (superseded by Smart Insights' positive-state fallback, section 4).

### 3. Priority Collections
Renamed from "Collection Queue". Same data source (`overdueList` / `dues`), new presentation:

- Header: "Priority Collections" + count badge (reuse existing "N overdue" badge style).
- Top 3 only (was top 4), each tagged with an urgency bucket color, computed from days-since-due:
  - 🔴 `> 30` days
  - 🟠 `15–30` days
  - 🟡 `7–15` days
  - ⚪ `< 7` days / due-soon (current bucket)
- Card content and actions (call, WhatsApp, Collect) unchanged from current implementation.
- "View All Dues (N) →" unchanged — still opens the existing `OutstandingDuesDrawer`.

### 4. Smart Insights
New section. A pure function computes a list of insight objects `{ icon, text, tone }` from data already in scope, then the component renders up to **4**, in this priority order (skip any that don't apply):

1. **Pace vs target** — compare `% of month elapsed` (`dayOfMonth / daysInMonth`) against `collectionRate / 100`. If behind by ≥5 points: "Collection is N% behind pace this month." If ahead: "Collection is N% ahead of pace this month." (only shown if `expectedVal > 0`)
2. **Recover-to-milestone** — next 5%-rounded milestone strictly above current `collectionRate` (e.g. 56% → 60%); amount needed = `(milestone/100) * expectedVal - collectedVal`. "Recover ₹X today to reach Y%." (only if milestone amount > 0 and collectionRate < 100)
3. **Top-dues hostel** — only when `hostelId === 'all'` and there are ≥2 hostels with dues: hostel with the highest share of total `outstandingVal`, as a %. "`<Hostel>` contributes N% of all dues."
4. **Reminder dependency** (folded from the old Revenue Health grid) — "N% of tenants needed a reminder to pay this cycle." shown when `reminderDependency > 0`.
5. **Unconfirmed payments** (folded from the dropped card) — "N payment proof(s) awaiting review (₹X)." shown when `pendingPaymentsCount > 0`. Links to `/alerts` like today.
6. **Due this week** (folded from the dropped card) — "₹X due this week from N tenant(s)." shown when `upcomingCount > 0`.

If zero insights apply (fully caught up, no dues, no pending items), render one positive fallback line: "✓ All caught up — no overdue collections or pending items."

Cap at 4 lines total by the priority order above (1 and 2 are near-always applicable when there's any expected revenue, so in practice 2 of the conditional ones from {3,4,5,6} will typically show).

### 5. Property Finance
New section, **conditionally rendered** (`hostelId === 'all'` only, and ≥2 hostels present — with exactly 1 hostel the "All Hostels" view and single-hostel view are equivalent, so there's nothing to compare there either).

- One card per hostel: name, Revenue (that hostel's `revenue` from its `statsShell`), Collection % (that hostel's own rate, not the aggregate), Pending (that hostel's `pending_dues`).
- Sort best → worst by collection %.
- Rank badge uses the **existing** color thresholds already used elsewhere in this file for collection rate (`≥80%` emerald/🥇-equivalent, `≥50%` amber, `<50%` red) — not new thresholds invented for this section, to stay consistent with how "good/bad" is signaled everywhere else on this screen.
- Requires keeping each hostel's individual `statsShell` result (currently the component only keeps the *summed* `stats`) — the per-hostel array (`statsShells`) already exists in the query results and just needs the hostel id/name attached (same pattern already used for `recentActivity`/`payments`/`dues` in the current file).

### 6. Recent Transactions
Replaces "Recent Financial Activity" as the default view, with the full `PaymentLedger` demoted to an expandable secondary view:

- Default: last 5 items from the existing `financeActivity` list (already type-filtered to `payment`/`expense`), same row rendering as today's "Recent Financial Activity" (icon, title, detail, relative time).
- "View All →" toggle reveals the existing `PaymentLedger` component (search, filter, full table) below, collapsed by default — same pattern already used for the "Cashflow, Expenses & Collection Charts" collapsible section today (`showAnalytics` state), just repurposed.

### Removed entirely (not relocated)
- Old Net Cash Flow KPI grid (superseded by Collection Progress).
- Standalone Revenue Health grid (folded into Smart Insights, item 4; on-time % and expense ratio are dropped as they're less actionable than reminder dependency and would push past the 4-insight cap).
- Expense Summary block (category breakdown + Add Expense/View Expenses buttons) — redundant with the dedicated Expenses Workspace tab; "Add Expense" remains reachable via the header action bar.
- The collapsible "Cashflow, Expenses & Collection Charts" section and its 3 chart components.

## Cleanup

Delete as dead code (verified via repo-wide grep, zero import references outside their own file):

- Pre-existing, unrelated to this change: `CashPosition.tsx`, `CollectionPipeline.tsx`, `HealthBar.tsx`, `OverdueIntelligence.tsx`, `PaymentAttemptsIntelligence.tsx`, `RiskZone.tsx`, `RoomPerformance.tsx`, `SmartFilters.tsx`, `TodayPriorities.tsx`, `FinancialSummaryStrip.tsx`, `AdvancedPaymentTable.tsx`, `CashflowCharts.tsx`, `FinancialTimeline.tsx` (this last one is unrelated to `financial-timeline-service.ts` on the backend or `getFinancialTimeline` on tenant profile — different feature, name collision only).
- Newly orphaned by this change: `CashflowForecast.tsx`, `CollectionAnalytics.tsx`, `ExpenseIntelligence.tsx` (only consumer was the removed charts section).

`OutstandingDuesDrawer` (defined inline in `FinancialControlCenter.tsx`) stays as-is.

## Testing / verification

`frontend-v2` has no test suite (per `CLAUDE.md`). Verification is: `npm run build` (runs `check:architecture` + `vite build` + branding check) must pass, then manual verification in a running dev server — both "All Hostels" and single-hostel selections, a hostel with overdue dues and one without, to confirm Property Finance visibility, Smart Insights conditional logic, and the Recent Transactions → full ledger expand toggle all behave correctly per this spec.

## Documentation

Per `CLAUDE.md`'s documentation rule, this is a significant refactor of an existing feature (not a new API/schema/business-rule), so the required update is to `docs/obsidian/Features.md` and `docs/obsidian/Changelog.md` in the same change.
