# Expenses module — product & UX audit

**Date:** 2026-08-05 · **Status:** For review before Phase 2 · Author: engineering audit against live code and live data

Every claim below was verified by reading the implementation and, where noted, by querying the production database. Nothing here is inferred from screenshots. Where something could not be verified it is marked **Unverified**.

**Context:** Phase 1 (expense memory) shipped 2026-08-05, [[ADR-047]]. This audit covers the whole lifecycle, not the screens Phase 1 touched.

---

## 0. The single most important finding

**Expenses cannot be attributed to a hostel, and the backend was built for it.**

`apps/frontend/src/features/expenses/api/index.js` does this on every create:

```js
let payload = { ...data, expense_scope: 'BUSINESS' };
delete payload.hostelId;   // "expenses are portfolio-level"
```

Meanwhile the schema has `expenses.hostel_id`, an `ExpenseScope` enum with a `HOSTEL` member that is the **default**, and three composite indexes built specifically for per-hostel querying (`[hostel_id, category, date]`, `[hostel_id, date]`, `[hostel_id, status]`). The export service already accepts a hostel filter and labels reports `"All Hostels (Portfolio)"` when absent.

**This is a regression, not a missing feature.** Queried live: **8 of 11 existing expenses already have `hostel_id` set and `expense_scope = HOSTEL`.** The data model is populated, the indexes are in use, and per-hostel reporting would work today for those rows — the current client simply stopped sending the field. Only 3 rows are genuinely portfolio-level.

So a multi-property owner cannot answer *"what does MG Road cost me versus Whitefield?"* — not because it's hard, and not because the data is missing, but because the client deletes the field on the way out and progressively makes the existing data unrepresentative.

**Impact: critical. Effort: small. Urgency: rising** — every expense recorded from now on loses attribution that older rows have.

---

## 1. Current problems

Ordered by impact.

| # | Problem | Evidence | Impact |
|---|---|---|---|
| 1 | Expenses are portfolio-only; hostel attribution discarded client-side | `api/index.js` deletes `hostelId`, forces `expense_scope: 'BUSINESS'` | **Critical** — blocks persona 3 entirely |
| 2 | Search filters, it does not inform | `MoneyPage.tsx:110-125` filters an in-memory array; `getTitleSummary` is never called | **Critical** — the stated Phase 2 goal |
| 3 | Search only sees what is already loaded | `filteredExpenses` derives from `real.expenses`, which is the current month | **High** — searching "Rice" silently misses last year |
| 4 | Summaries ignore the active filter | Cards read `real.categoryBreakdown` / `real.totalExpenses`; only the list reads `filteredExpenses` | **High** — search "Rice", totals still show the whole month |
| 5 | Date-range chips are decorative | `MoneyPage.tsx:240-246` renders `<span>` elements, no handler, "This month" hardcoded active | **High** — dead affordance #11 |
| 6 | Dashboard has ~12 competing blocks before the list | See §5 | **High** |
| 7 | Revenue / Expenses / Net rendered twice on one screen | `BusinessHealthStrip` **and** `MoneyStatTiles` | **Medium** |
| 8 | Receipts cannot be attached at all | "Attach receipt image" in `ReviewStep.tsx:51` is a `<button>` with no `onClick`, no file input, no handler — while `api/index.js` fully implements the multipart upload path. Live: **0 of 11 expenses have a receipt** | **High** — dead affordance #12; blocks persona 4 outright |
| 9 | No vendor summary anywhere | `getExpenseTitleSummary` exists; there is no vendor equivalent | **Medium** |
| 10 | `getFrequentExpenses` is now dead weight | Superseded by `getExpenseMemory`; still routed at `mode=suggestions`, still zero callers | **Low** |

---

## 2. UX issues

**Information hierarchy is inverted.** The Expenses tab leads with four summary blocks and a trend chart, then the search bar, then chips, and only then the actual expenses. An owner opening this tab overwhelmingly wants either *"add one"* or *"find one"*. Both are below the fold.

**The screen answers a question nobody asked first.** "Net profit" is the first thing shown on the *Expenses* tab. It belongs on Overview. The Expenses tab should lead with expense reality.

**Terminology drift.** The UI says "Recent expenses" for a list that is actually *this month, filtered*. It says "Insights" for what are single largest-value facts, not insights. "Business Health" is a strip showing two numbers.

**Filter state is invisible.** Applying filters in the modal changes the list, but nothing on the screen shows *what* is applied — the chips row is fake and the search bar shows no active-filter count. An owner cannot tell why they are seeing 3 rows.

**Empty state lies.** When filters exclude everything, the list says *"No expenses logged this month yet."* — which is false, and sends the owner to add a duplicate.

**Repeated data entry (partially solved).** Phase 1 fixed the worst of it: vendor, category, payment method, notes and recurrence now reuse in one tap. What remains is the **amount**, which is genuinely per-transaction, and the **receipt**, which is still a separate manual step every time.

---

## 3. Business opportunities

Ranked by owner value.

1. **Per-hostel cost visibility** — unlocks property comparison, per-property P&L, and property-filtered exports. Unblocks the entire multi-property persona. *(Requires only un-deleting a field plus a picker.)*
2. **Search as business intelligence** — "Rice" answers *how much, how often, average, largest, last, main vendor, trend vs. previous period* before showing transactions. The backend already computes six of those seven.
3. **Price-change detection** — the memory aggregate already returns `averageAmount`, `highestAmount` and `lastAmount` per vendor. Comparing the new entry's amount against that range gives *"₹9,500 — that's 19% above your usual ₹8,000 for Sri Rice Traders"* at the moment of entry, with no new data and no AI.
4. **Recurring-expense completeness** — `is_recurring` and `recurring_frequency` are captured but nothing acts on them. A month-end *"3 usual expenses not yet recorded"* prompt uses only history.
5. **Vendor consolidation insight** — where two vendors serve the same category, show spend side by side. Pure aggregate, no new capture.
6. **Tax-ready reporting** — see §7.

---

## 4. Backend reuse opportunities

**This is where most of Phase 2–4 already exists.**

| Capability | Status | Wired to UI? |
|---|---|---|
| `getExpenseTitleSummary` — total, count, average monthly, highest, lowest, months tracked, transactions | **Built** | **No** |
| `getExpenseMemory` — per-title *and* per-vendor: occurrences, total, average, highest, last amount/date, category, payment method, notes, recurrence, receipt count, hostel count | Built (Phase 1) | Partially — entry form only |
| Export: CSV streaming | Built | Yes |
| Export: XLSX with summary, category %, vendor breakdown | Built (`ExcelJS` streaming) | Yes |
| Export: PDF with header, executive summary, category breakdown, vendor summary, transaction register, footer | Built (`pdf-lib`) | Yes |
| Hostel filter on exports (`"All Hostels (Portfolio)"`) | Built | Not reachable — no expense has a hostel |
| `hostels.logo_url` for report branding | Exists | Not used in exports |
| `expenses.receipt_url` / `receipt_uploaded_at` | Exists | Write-only |
| `expenses.tags` / `metadata` (JSON) | Exists | Unused — free extension points |
| Composite per-hostel indexes | Exist | Unreachable |

**The pattern to note:** this module has now produced *two* fully-built, fully-routed, never-called features (`getFrequentExpenses`, `getExpenseTitleSummary`). Both had frontend wrappers too. Phase 2 should begin by wiring what exists before adding anything.

---

## 5. Screens to simplify

Current Expenses tab, in render order:

```
BusinessHealthStrip        revenue + net profit
MoneyStatTiles             revenue, expenses, net profit      <- duplicates the strip
InsightTilesGrid           top category, top vendor, largest expense, anomaly
MonthlyTrendCard           trend chart
ExpenseSearchBar
date-range chips           <- decorative, non-functional
CategoryChipsRow
Recent expenses list       <- the actual content
ExpenseBreakdownCard       category breakdown again
TopVendorsCard             top vendor again
```

Four of these restate each other: net profit twice; top category in both `InsightTilesGrid` and `ExpenseBreakdownCard`; top vendor in both `InsightTilesGrid` and `TopVendorsCard`.

**Recommended structure:**

```
[ Search + active filter summary ]        always visible, top
[ This month: ₹X across N expenses ]      one line, filter-aware
[ Expense list ]                          the content
[ ▸ Where it went ]                       collapsed: categories + vendors
[ ▸ Trend ]                               collapsed: monthly comparison
```

Revenue and net profit move to Overview, where they belong. `BusinessHealthStrip`, `InsightTilesGrid`, `ExpenseBreakdownCard` and `TopVendorsCard` collapse into one expandable "Where it went" section — merging four components rather than adding a fifth.

---

## 6. Features to remove

| Item | Why |
|---|---|
| `MoneyStatTiles` on the Expenses tab | Duplicates `BusinessHealthStrip`; revenue/profit belong on Overview |
| Decorative date-range chips | Non-functional; either wire them or delete them — currently they teach the owner that taps do nothing |
| `getFrequentExpenses` + `mode=suggestions` + `expenseService.getSuggestions` | Superseded by `getExpenseMemory`; zero callers. Delete rather than leave a second, weaker answer to the same question |
| `mockFoodInsights`-style dead mock data in the expenses mocks | **Unverified** whether any expense mocks are still referenced after Phase 1 — worth a sweep |
| The separate `ExpenseBreakdownCard` / `TopVendorsCard` components | Merge into the collapsed section rather than keep as standalone cards |

---

## 7. Features to add

Ordered by value-to-effort.

**A. Hostel attribution (critical, small).** Stop deleting `hostelId`; add a hostel picker to the entry form defaulting to the active hostel, with an explicit "Whole business" option for genuinely portfolio-level costs. `expense_scope` already models exactly this distinction.

**B. Search summary panel (high, small — mostly wiring).** On search, call `getExpenseTitleSummary` and lead with total / count / average / largest / last / main vendor. Six of the seven already come back; only **trend vs. previous period** is new, and that is one more aggregate over the same table.

**C. Vendor summary (high, small).** `getExpenseMemory` already returns vendor-keyed entries with count, total, average and last date. A vendor search needs presentation, not computation.

**D. Filter-aware everything (high, small).** Move the summary figures onto the same filtered dataset the list uses, and surface active filters as removable chips. This also fixes the lying empty state.

**E. Price-change nudge at entry (medium, small).** Compare the typed amount against the memory's average/highest for that vendor. No new data, no AI, purely historical.

**F. Receipt capture, then lifecycle (high, small then medium).** The *capture* fix is tiny and should be promoted out of Phase 4: wire the existing dead button to a file input and pass `receipt_image` through — the API wrapper already builds the FormData. Preview / replace / download follow. For OCR readiness: store the file reference and a `metadata.ocr` slot now, extract nothing.

**G. Recurring-expense completeness prompt (medium, medium — blocked).** "3 usual expenses not yet recorded this month" would use `is_recurring` plus Phase 1's day-of-month pattern. **Blocked on data:** live check shows `is_recurring` is set on **0 of 11** expenses. The wizard has a recurring toggle, so either owners never use it or it is not reaching the payload — worth confirming before building anything on top. Until then this prompt would render empty for every owner.

**H. Report upgrade (medium, medium).** The PDF already has an executive summary, category breakdown, vendor summary and transaction register. The gaps against a CA-ready report are specific and small:
- No cover page (currently a header line)
- No hostel logo (`hostels.logo_url` exists) or Stayo mark
- Transaction register lacks **payment method, notes and receipt reference** — it shows Date / Title / Category / Status / Amount only
- Vendor summary lacks **payment count, average and last payment date**
- No month-on-month comparison
- No receipt appendix

That is a finishing job on an existing report, not a rewrite.

---

## 8. Implementation roadmap

**Phase 2 — Make the data answer questions** *(highest impact, mostly wiring)*
1. Hostel attribution on entry (A)
2. Filter-aware summaries + real date-range control + active-filter chips (D)
3. Search summary panel via `getExpenseTitleSummary` (B)
4. Vendor summary via existing memory (C)

**Phase 2.5 — Two one-line unblocks** *(trivial effort, disproportionate value)*
5. Wire the dead receipt-attach button (the upload path already exists end to end)
6. Confirm why `is_recurring` is never set, since recurring intelligence depends on it

**Phase 3 — Calm the dashboard** *(high impact, low risk)*
7. Collapse 10 blocks into 5; move revenue/profit to Overview; merge the four duplicate-fact cards (§5)
8. Delete `MoneyStatTiles` from this tab, the fake chips, and `getFrequentExpenses` (§6)

**Phase 4 — Audit and intelligence**
9. Receipt lifecycle — preview, replace, download — + OCR-ready metadata slot (F)
10. Report finishing: cover, branding, fuller register, vendor detail, comparison, appendix (H)
11. Price-change nudge (E); recurring-completeness prompt (G) only if the capture question resolves

**Cross-cutting prerequisite:** the backend test suite still cannot run without `DATABASE_URL_TEST`. Phases 1–3 are coverable with pure functions; **Phase 4 is not** — PDF generation, receipt upload and OCR wiring are inherently I/O. A test database should exist before Phase 4 starts.

---

## Persona coverage after Phase 1

| Persona | Served today | Biggest remaining gap |
|---|---|---|
| Small owner (speed) | **Good** — memory + one-tap reuse landed in Phase 1 | Receipt step still manual every time |
| Growing hostel (organisation) | **Partial** — vendor history exists but is only visible during entry | Search summaries; receipt lifecycle |
| Multi-property (comparison) | **Not served** | Hostel attribution is discarded at source |
| Audit-focused (records) | **Partial** — exports are better than expected, but **no receipt can be attached at all** | Receipt capture first, then cover/branding, fuller register, appendix |

---

## Evidence notes

- Live data at time of audit: **11 expenses** for the primary owner; two repeated titles, one repeated vendor. Small enough that pattern detection correctly declines to claim a monthly cadence (Phase 1 behaviour, verified).
- Verified by reading: `expense-service.ts`, `expense-export-service.ts`, `app/api/expenses/route.ts`, `MoneyPage.tsx`, `features/expenses/api/index.js`, `prisma/schema.prisma`.
- Live counts at time of audit (primary owner, 11 expenses):
  - `expense_scope`: **HOSTEL = 8, BUSINESS = 3** — historical rows *do* carry hostel attribution
  - `hostel_id` set on **8/11**
  - `receipt_url` set on **0/11** — explained by the dead attach button
  - `is_recurring` true on **0/11** — recurring intelligence has no data to stand on yet
- These four numbers changed three conclusions in this audit: hostel attribution is a regression rather than a gap, receipts are blocked at capture rather than at lifecycle, and the recurring-expense prompt is data-blocked rather than merely unbuilt.
