# Financial Control Center (Overview Tab) Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Overview" tab of the owner Money screen (`FinancialControlCenter.tsx`) with a five-section layout — Collection Progress, Priority Collections, Smart Insights, Property Finance, Recent Transactions — per the approved design spec, with no backend changes and no functionality regressions.

**Architecture:** Extract pure, side-effect-free display logic (urgency bucketing, insight generation, per-hostel ranking, today's-collection sum) into a new sibling module `financeInsights.ts`. `FinancialControlCenter.tsx` keeps all data-fetching (unchanged) and gains a small block of new `useMemo`s that call into `financeInsights.ts`, then its `return (...)` JSX is replaced wholesale with the new section layout (the five sections are one designed visual system — partial application would leave a half-old/half-new screen, so this is a single task). 15 now-dead component files (12 pre-existing orphans + 3 that only this redesign's removed chart section consumed) are deleted in one cleanup task; two `docs/obsidian/` pages are updated per `CLAUDE.md`'s documentation rule.

**Tech Stack:** React 19, TypeScript, TanStack Query (`useQuery`/`useQueries`), Tailwind, `lucide-react` icons, Vite. No test framework in `frontend-v2` — verification per task is `npx tsc -p tsconfig.json --noEmit` (typecheck) plus, in the final task, `npm run build` and manual dev-server walkthrough.

## Global Constraints

- No backend changes. All new computations use data already fetched by `FinancialControlCenter.tsx` (per design spec §"Data — no backend changes").
- No new test files — `frontend-v2` has no test suite (per `CLAUDE.md`); each task's verification is a TypeScript typecheck, and the final task adds `npm run build` + manual verification.
- Property Finance section renders only when `hostelId === 'all'` AND there are ≥2 hostels with data (per spec §5).
- Smart Insights caps at 4 lines, in the fixed priority order defined in the spec §4; if none apply, show exactly one positive fallback line.
- Reuse the existing collection-rate color thresholds (`≥80` good, `≥50` warning, `<50` critical) for Property Finance ranking — do not invent new thresholds (per spec §5).
- Keep `OwnerActionsBar` (all 4 buttons), `PaymentLedger`, `RecordPaymentModal`, `PaymentDetailDrawer`, `AddExpenseModal`, and the inline `OutstandingDuesDrawer` unchanged.
- Delete dead code rather than leave newly-orphaned files (per spec §"Cleanup") — verify zero remaining references before each deletion.

---

## File Structure

| File | Change |
|---|---|
| `frontend-v2/src/app/components/views/billing/financeInsights.ts` | **Create.** Pure helper functions and types: `getUrgencyMeta`, `computeTodaysCollection`, `computeSmartInsights`, `computePropertyFinance`. |
| `frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx` | **Modify.** Add new memoized values (Task 2), replace the entire `return (...)` JSX (Task 3). |
| `frontend-v2/src/app/components/views/billing/{CashPosition,CollectionPipeline,HealthBar,OverdueIntelligence,PaymentAttemptsIntelligence,RiskZone,RoomPerformance,SmartFilters,TodayPriorities,FinancialSummaryStrip,AdvancedPaymentTable,CashflowCharts,FinancialTimeline,CashflowForecast,CollectionAnalytics,ExpenseIntelligence}.tsx` | **Delete** (Task 4). 15 files, zero remaining references after Task 3. |
| `docs/obsidian/Features.md` | **Modify** (Task 5). Update the "Billing / financial control center" row. |
| `docs/obsidian/Changelog.md` | **Modify** (Task 5). Add an `[Unreleased]` entry. |

---

### Task 1: Create `financeInsights.ts` (pure helper module)

**Files:**
- Create: `frontend-v2/src/app/components/views/billing/financeInsights.ts`

**Interfaces:**
- Produces (consumed by Task 2 and Task 3):
  - `getUrgencyMeta(daysLate: number): UrgencyMeta` where `UrgencyMeta = { emoji: string; label: string; badgeClass: string }`
  - `computeTodaysCollection(payments: Array<Record<string, unknown>>): number`
  - `computeSmartInsights(input: SmartInsightsInput): SmartInsight[]` where `SmartInsight = { icon: string; text: string; tone: Tone }`, `Tone = 'good' | 'warning' | 'critical' | 'neutral'`
  - `computePropertyFinance(perHostel: PerHostelFinance[]): PropertyFinanceCard[]` where `PerHostelFinance = { hostelId: string; hostelName: string; revenue: number; expected_revenue: number; pending_dues: number }` and `PropertyFinanceCard = PerHostelFinance & { collectionRate: number; pending: number; tone: Tone; medal: string }`

- [ ] **Step 1: Write the module**

```ts
export type Tone = 'good' | 'warning' | 'critical' | 'neutral';

export interface UrgencyMeta {
  emoji: string;
  label: string;
  badgeClass: string;
}

export function getUrgencyMeta(daysLate: number): UrgencyMeta {
  if (daysLate > 30) {
    return {
      emoji: '🔴',
      label: `${daysLate} days late`,
      badgeClass: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
    };
  }
  if (daysLate > 15) {
    return {
      emoji: '🟠',
      label: `${daysLate} days late`,
      badgeClass: 'bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400',
    };
  }
  if (daysLate > 7) {
    return {
      emoji: '🟡',
      label: `${daysLate} days late`,
      badgeClass: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
    };
  }
  return {
    emoji: '⚪',
    label: daysLate <= 0 ? 'Due today' : `${daysLate} days late`,
    badgeClass: 'bg-muted text-muted-foreground',
  };
}

export function computeTodaysCollection(payments: Array<Record<string, unknown>>): number {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  let total = 0;
  for (const p of payments) {
    const dateStr = (p.payment_date ?? p.paymentDate) as string | undefined;
    if (!dateStr) continue;
    const d = new Date(dateStr);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key === todayKey) {
      total += Number((p.amount_paid ?? p.amount) ?? 0);
    }
  }
  return total;
}

export interface SmartInsight {
  icon: string;
  text: string;
  tone: Tone;
}

export interface PerHostelFinance {
  hostelId: string;
  hostelName: string;
  revenue: number;
  expected_revenue: number;
  pending_dues: number;
}

export interface SmartInsightsInput {
  expectedVal: number;
  collectedVal: number;
  collectionRate: number;
  reminderDependency: number;
  pendingPaymentsCount: number;
  pendingPaymentsTotal: number;
  upcomingCount: number;
  upcomingTotal: number;
  isAllHostels: boolean;
  perHostel: PerHostelFinance[];
  fmtK: (n: number) => string;
}

export function computeSmartInsights(input: SmartInsightsInput): SmartInsight[] {
  const {
    expectedVal,
    collectedVal,
    collectionRate,
    reminderDependency,
    pendingPaymentsCount,
    pendingPaymentsTotal,
    upcomingCount,
    upcomingTotal,
    isAllHostels,
    perHostel,
    fmtK,
  } = input;

  const insights: SmartInsight[] = [];

  // 1. Pace vs target
  if (expectedVal > 0) {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pacePct = Math.round((now.getDate() / daysInMonth) * 100);
    const diff = collectionRate - pacePct;
    if (diff <= -5) {
      insights.push({ icon: '💡', text: `Collection is ${Math.abs(diff)}% behind pace this month.`, tone: 'warning' });
    } else if (diff >= 5) {
      insights.push({ icon: '📈', text: `Collection is ${diff}% ahead of pace this month.`, tone: 'good' });
    }
  }

  // 2. Recover-to-milestone
  if (expectedVal > 0 && collectionRate < 100) {
    const milestone = Math.min(100, Math.floor(collectionRate / 5) * 5 + 5);
    const amountNeeded = Math.round((milestone / 100) * expectedVal - collectedVal);
    if (amountNeeded > 0) {
      insights.push({ icon: '⚠', text: `Recover ${fmtK(amountNeeded)} today to reach ${milestone}%.`, tone: 'warning' });
    }
  }

  // 3. Top-dues hostel (all-hostels view only, and only if it's a meaningful share)
  if (isAllHostels && perHostel.length >= 2) {
    const totalOutstanding = perHostel.reduce((sum, h) => sum + h.pending_dues, 0);
    if (totalOutstanding > 0) {
      const top = [...perHostel].sort((a, b) => b.pending_dues - a.pending_dues)[0];
      const share = Math.round((top.pending_dues / totalOutstanding) * 100);
      if (share >= 25) {
        insights.push({ icon: '💰', text: `${top.hostelName} contributes ${share}% of all dues.`, tone: 'neutral' });
      }
    }
  }

  // 4. Reminder dependency (folded from the old Revenue Health grid)
  if (reminderDependency > 0) {
    insights.push({
      icon: '🔔',
      text: `${reminderDependency}% of tenants needed a reminder to pay this cycle.`,
      tone: reminderDependency > 50 ? 'warning' : 'neutral',
    });
  }

  // 5. Unconfirmed payments (folded from the dropped card)
  if (pendingPaymentsCount > 0) {
    insights.push({
      icon: '🧾',
      text: `${pendingPaymentsCount} payment proof${pendingPaymentsCount === 1 ? '' : 's'} awaiting review (${fmtK(pendingPaymentsTotal)}).`,
      tone: 'warning',
    });
  }

  // 6. Due this week (folded from the dropped card)
  if (upcomingCount > 0) {
    insights.push({
      icon: '📅',
      text: `${fmtK(upcomingTotal)} due this week from ${upcomingCount} tenant${upcomingCount === 1 ? '' : 's'}.`,
      tone: 'neutral',
    });
  }

  if (insights.length === 0) {
    return [{ icon: '✓', text: 'All caught up — no overdue collections or pending items.', tone: 'good' }];
  }

  return insights.slice(0, 4);
}

export interface PropertyFinanceCard extends PerHostelFinance {
  collectionRate: number;
  pending: number;
  tone: Tone;
  medal: string;
}

export function computePropertyFinance(perHostel: PerHostelFinance[]): PropertyFinanceCard[] {
  return perHostel
    .map((h) => {
      const collectionRate = h.expected_revenue > 0 ? Math.round((h.revenue / h.expected_revenue) * 100) : 0;
      const tone: Tone = collectionRate >= 80 ? 'good' : collectionRate >= 50 ? 'warning' : 'critical';
      const medal = tone === 'good' ? '🥇' : tone === 'warning' ? '🟡' : '🔴';
      return {
        ...h,
        collectionRate,
        pending: h.pending_dues,
        tone,
        medal,
      };
    })
    .sort((a, b) => b.collectionRate - a.collectionRate);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend-v2 && npx tsc -p tsconfig.json --noEmit`
Expected: no errors mentioning `financeInsights.ts`. (Errors in unrelated pre-existing files, if any, are not caused by this change — only confirm nothing new references this file yet.)

- [ ] **Step 3: Commit**

```bash
git add frontend-v2/src/app/components/views/billing/financeInsights.ts
git commit -m "feat(billing): add pure helpers for Financial Control Center redesign"
```

---

### Task 2: Wire new computed values into `FinancialControlCenter.tsx`

**Files:**
- Modify: `frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx:1-18` (imports)
- Modify: `frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx:875-877` (insert new memo block between the end of the `funnel` `useMemo` and `return (`)

**Interfaces:**
- Consumes: `getUrgencyMeta`, `computeTodaysCollection`, `computeSmartInsights`, `computePropertyFinance`, `PerHostelFinance` from Task 1's `./financeInsights`. Also consumes existing in-scope values: `statsShells`, `queryConfigs`, `queryResults`, `hostels`, `payments`, `expectedVal`, `collectedVal`, `collectionRate`, `reminderDependency`, `pendingPaymentsCount`, `pendingPaymentsTotal`, `upcomingCount`, `upcomingTotal`, `fmtK`, `hostelId`.
- Produces (consumed by Task 3's JSX): `isAllHostels: boolean`, `perHostelFinance: PerHostelFinance[]`, `todaysCollection: number`, `propertyFinanceCards: PropertyFinanceCard[]`, `smartInsights: SmartInsight[]`.

- [ ] **Step 1: Add the import**

In the import block (top of file), after the existing line:
```ts
import { EXPENSE_CATEGORIES } from '@features/expenses/constants';
```
add:
```ts
import { computeTodaysCollection, computePropertyFinance, computeSmartInsights } from './financeInsights';
```

(`getUrgencyMeta` is imported separately in Task 3, where it's first used, to keep this step's diff scoped to what Task 2 actually calls.)

- [ ] **Step 2: Insert the new memoized values**

Find this existing code (the end of the `funnel` useMemo, immediately before `return (`):

```ts
    return {
      reminders_sent,
      conversion_rate,
      channel_performance,
    };
  }, [funnels]);

  return (
```

Replace it with (adds the new block, keeps `return (` at the end unchanged):

```ts
    return {
      reminders_sent,
      conversion_rate,
      channel_performance,
    };
  }, [funnels]);

  const isAllHostels = hostelId === 'all';

  const perHostelFinance = useMemo(() => {
    return statsShells
      .map((shell: any) => {
        const shellConfig = queryConfigs.find(
          (c, cidx) => queryResults[cidx]?.data === shell && c.meta?.type === 'statsShell'
        );
        const hId = shellConfig?.meta?.hostelId;
        const hostelName = hostels.find((h: any) => h.id === hId)?.name ?? 'Hostel';
        return {
          hostelId: hId,
          hostelName,
          revenue: Number(shell?.revenue ?? 0),
          expected_revenue: Number(shell?.expected_revenue ?? 0),
          pending_dues: Number(shell?.pending_dues ?? 0),
        };
      })
      .filter((h) => Boolean(h.hostelId));
  }, [statsShells, queryConfigs, queryResults, hostels]);

  const todaysCollection = useMemo(() => computeTodaysCollection(payments), [payments]);

  const propertyFinanceCards = useMemo(() => computePropertyFinance(perHostelFinance), [perHostelFinance]);

  const smartInsights = useMemo(
    () =>
      computeSmartInsights({
        expectedVal,
        collectedVal,
        collectionRate,
        reminderDependency,
        pendingPaymentsCount,
        pendingPaymentsTotal,
        upcomingCount,
        upcomingTotal,
        isAllHostels,
        perHostel: perHostelFinance,
        fmtK,
      }),
    [
      expectedVal,
      collectedVal,
      collectionRate,
      reminderDependency,
      pendingPaymentsCount,
      pendingPaymentsTotal,
      upcomingCount,
      upcomingTotal,
      isAllHostels,
      perHostelFinance,
    ]
  );

  return (
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend-v2 && npx tsc -p tsconfig.json --noEmit`
Expected: no new errors. (The old JSX below still compiles unchanged; the new values are simply unused by it until Task 3 — `noUnusedLocals` is `false` in `tsconfig.json`, so this is not an error.)

- [ ] **Step 4: Commit**

```bash
git add frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx
git commit -m "feat(billing): compute today's collection, per-hostel finance, and smart insights"
```

---

### Task 3: Replace the render output with the new five-section layout

**Files:**
- Modify: `frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx:1-18` (imports — remove now-unused, add new)
- Modify: `frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx:26-33` (delete `AnalyticsFallback`, no longer used)
- Modify: `frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx:189` (rename state `showAnalytics` → `showFullLedger`)
- Modify: `frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx:877-1327` (the entire `return (...)` JSX, from `<div className="space-y-5 pb-20">` through the closing `</div>` and modal renders)

**Interfaces:**
- Consumes: everything produced by Task 2, plus existing values already in scope (`overdueList`, `dueBalance`, `fmtK`, `WhatsAppIcon`, `handleCollect`, `handleRowClick`, `payments`, `paymentsData`, `refetchPayments`, `financeActivity`, `selectedObligationId`, `resolvedHostelIdForObligation`, `showDuesDrawer`, `recordPayment`, `showAddExpense`, `createExpenseMutation`, `OutstandingDuesDrawer`, `PaymentDetailDrawer`, `RecordPaymentModal`, `AddExpenseModal`, `OwnerActionsBar`, `PaymentLedger`).
- Produces: nothing further (leaf of the tree for this component).

- [ ] **Step 1: Update imports**

Replace:
```ts
import { 
  BarChart3, ChevronDown, Phone, Calendar, DollarSign, Receipt, X, Clock
} from 'lucide-react';
import { queryKeys } from '@lib/queryKeys';
import { OwnerActionsBar } from './OwnerActionsBar';
import { PaymentLedger } from './PaymentLedger';
import { RecordPaymentModal } from '../../modals/RecordPaymentModal';
import { EXPENSE_CATEGORIES } from '@features/expenses/constants';
import { computeTodaysCollection, computePropertyFinance, computeSmartInsights } from './financeInsights';

const CashflowForecast = lazy(() => import('./CashflowForecast').then((m) => ({ default: m.CashflowForecast })));
const CollectionAnalytics = lazy(() => import('./CollectionAnalytics').then((m) => ({ default: m.CollectionAnalytics })));
const ExpenseIntelligence = lazy(() => import('./ExpenseIntelligence').then((m) => ({ default: m.ExpenseIntelligence })));
const PaymentDetailDrawer = lazy(() => import('./PaymentDetailDrawer').then((m) => ({ default: m.PaymentDetailDrawer })));
const AddExpenseModal = lazy(() => import('../../hostel-detail/tabs/expenses/AddExpenseModal').then((m) => ({ default: m.AddExpenseModal })));
```

with:
```ts
import { 
  ChevronDown, Phone, DollarSign, Receipt, X, Clock
} from 'lucide-react';
import { queryKeys } from '@lib/queryKeys';
import { OwnerActionsBar } from './OwnerActionsBar';
import { PaymentLedger } from './PaymentLedger';
import { RecordPaymentModal } from '../../modals/RecordPaymentModal';
import { EXPENSE_CATEGORIES } from '@features/expenses/constants';
import { computeTodaysCollection, computePropertyFinance, computeSmartInsights, getUrgencyMeta } from './financeInsights';

const PaymentDetailDrawer = lazy(() => import('./PaymentDetailDrawer').then((m) => ({ default: m.PaymentDetailDrawer })));
const AddExpenseModal = lazy(() => import('../../hostel-detail/tabs/expenses/AddExpenseModal').then((m) => ({ default: m.AddExpenseModal })));
```

(`BarChart3` and `Calendar` are dropped — both were only used by JSX this task removes. `computeTodaysCollection`/`computePropertyFinance`/`computeSmartInsights` stay imported for Task 2's memo block above; `getUrgencyMeta` is newly added here.)

- [ ] **Step 2: Delete the now-unused `AnalyticsFallback` function**

Delete:
```ts
function AnalyticsFallback() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="h-44 rounded-xl bg-muted animate-pulse" />
      <div className="h-44 rounded-xl bg-muted animate-pulse" />
    </div>
  );
}

```

- [ ] **Step 3: Rename the collapse-toggle state**

Replace:
```ts
  const [showAnalytics, setShowAnalytics] = useState(true);
```
with:
```ts
  const [showFullLedger, setShowFullLedger] = useState(false);
```

(Default changes from expanded to collapsed — Recent Transactions' 5-row summary is the primary view now; the full ledger is opt-in, per spec §6.)

- [ ] **Step 4: Replace the entire return statement**

Replace everything from `return (` through the end of the component (the final `);` and closing `}`) with:

```tsx
  return (
    <div className="space-y-5 pb-20">
      <OwnerActionsBar
        onRecordPayment={() => handleCollect()}
        onAddExpense={() => setShowAddExpense(true)}
        hostelId={hostelId}
      />

      {/* 1. Collection Progress */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-muted-foreground uppercase tracking-wider">Collection Progress</span>
          <span className={collectionRate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : collectionRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
            {collectionRate}%
          </span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${collectionRate >= 80 ? 'bg-emerald-500' : collectionRate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(collectionRate, 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">{fmtK(collectedVal)} / {fmtK(expectedVal)}</p>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground font-medium">Collected</span>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtK(collectedVal)}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground font-medium">Pending</span>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{fmtK(outstandingVal)}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground font-medium">Today's Collection</span>
            <p className="text-lg font-bold text-foreground">{fmtK(todaysCollection)}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground font-medium">Target</span>
            <p className="text-lg font-bold text-foreground">{fmtK(expectedVal)}</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground pt-2 border-t border-border/50">
          Cash: <span className="font-semibold text-foreground">{fmtK(collectionsSplit.cash)}</span> · UPI:{' '}
          <span className="font-semibold text-foreground">{fmtK(collectionsSplit.upi)}</span>
        </p>
      </div>

      {/* 2. Priority Collections */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Priority Collections</h3>
          <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-semibold">{overdueList.length} overdue</span>
        </div>

        {overdueList.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {overdueList.slice(0, 3).map((due, i) => {
              const tenantName = due.tenant_name ?? due.name ?? 'Tenant';
              const roomNo = due.room_no ?? due.room_number ?? 'N/A';
              const balance = dueBalance(due);
              const rawPhone = due.phone ?? due.tenant_phone ?? due.tenantPhone;
              const phone = rawPhone ? String(rawPhone).trim() : null;
              const telPhone = phone ? phone.replace(/[^\d+]/g, '') : null;

              const dueTime = due.due_date ? new Date(String(due.due_date)).getTime() : 0;
              const daysLate = Math.max(0, Math.floor((Date.now() - dueTime) / (1000 * 60 * 60 * 24)));
              const urgency = getUrgencyMeta(daysLate);

              let whatsappUrl = null;
              if (phone) {
                let clean = phone.replace(/[^\d]/g, '');
                if (clean.length === 10) clean = '91' + clean;
                const msg = `Hi ${tenantName}, this is a friendly reminder regarding your rent of ${fmtK(balance)} which is ${daysLate} days overdue. Please clear it at your earliest convenience. Thank you!`;
                whatsappUrl = `https://wa.me/${clean}?text=${encodeURIComponent(msg)}`;
              }

              return (
                <div key={due.id ?? i} className="p-3 bg-card border border-border/80 rounded-xl flex flex-col justify-between gap-3 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold text-foreground text-sm flex items-center gap-1">
                        <span>{urgency.emoji}</span>
                        {tenantName}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Room {roomNo} {due.hostelName ? `• ${due.hostelName}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-600 dark:text-red-400">{fmtK(balance)} overdue</p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 inline-block ${urgency.badgeClass}`}>
                        {urgency.label}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-border/50">
                    {telPhone && (
                      <a
                        href={`tel:${telPhone}`}
                        className="w-8 h-8 flex items-center justify-center bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-full active:scale-95 transition-all shrink-0"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {whatsappUrl && (
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 flex items-center justify-center bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-full active:scale-95 transition-all shrink-0"
                      >
                        <WhatsAppIcon />
                      </a>
                    )}
                    <button
                      onClick={() => handleCollect(due)}
                      className="flex-1 bg-primary text-primary-foreground text-xs font-semibold py-1.5 px-3 rounded-lg hover:bg-primary/95 active:scale-[0.98] transition-all"
                    >
                      Collect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-4 text-center">No overdue rent collections in queue.</div>
        )}

        {overdueList.length > 0 && (
          <button
            onClick={() => setShowDuesDrawer(true)}
            className="text-xs text-primary font-medium hover:underline flex items-center gap-1 mt-1 pt-1.5"
          >
            View All Dues ({overdueList.length}) →
          </button>
        )}
      </div>

      {/* 3. Smart Insights */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2.5 shadow-sm">
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Smart Insights</h3>
        <div className="space-y-2">
          {smartInsights.map((insight, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 text-xs rounded-lg px-2.5 py-2 ${
                insight.tone === 'good'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400'
                  : insight.tone === 'warning'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400'
                  : insight.tone === 'critical'
                  ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                  : 'bg-muted/40 text-foreground'
              }`}
            >
              <span className="shrink-0">{insight.icon}</span>
              <span>{insight.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Property Finance */}
      {isAllHostels && propertyFinanceCards.length >= 2 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Property Finance</h3>
          <div className="space-y-2">
            {propertyFinanceCards.map((card) => (
              <div key={card.hostelId} className="flex items-center justify-between rounded-lg border border-border/80 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span>{card.medal}</span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{card.hostelName}</p>
                    <p className="text-[11px] text-muted-foreground">Revenue {fmtK(card.revenue)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${card.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : card.tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                    {card.collectionRate}%
                  </p>
                  <p className="text-[11px] text-muted-foreground">{fmtK(card.pending)} pending</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Recent Transactions */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Recent Transactions</h3>
          <span className="ml-auto text-xs text-muted-foreground">{financeActivity.length} events</span>
        </div>
        <div className="divide-y divide-border px-4">
          {financeActivity.length > 0 ? (
            financeActivity.slice(0, 5).map((item: any, i: number) => {
              const dateStr = item.date ?? '';
              const type = item.type;

              let primary = item.title ?? '';
              let secondary = item.detail ?? '';

              let relativeDate = '';
              if (dateStr) {
                try {
                  const diff = Date.now() - new Date(dateStr).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 60) relativeDate = `${Math.max(1, mins)}m ago`;
                  else {
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) relativeDate = `${hrs}h ago`;
                    else {
                      const days = Math.floor(hrs / 24);
                      relativeDate = `${days}d ago`;
                    }
                  }
                } catch {
                  relativeDate = '';
                }
              }

              return (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                    type === 'payment' ? 'bg-emerald-500/15' : 'bg-red-500/15'
                  }`}>
                    {type === 'payment' ? (
                      <DollarSign className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Receipt className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{primary}</div>
                    {secondary && <div className="text-xs text-muted-foreground">{secondary}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    {relativeDate && <div className="text-xs text-muted-foreground">{relativeDate}</div>}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-6 text-center text-xs text-muted-foreground">No recent financial activity</div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFullLedger((value) => !value)}
          className="flex w-full items-center justify-center gap-2 px-4 py-2.5 border-t border-border text-xs font-medium text-primary hover:bg-muted/40 transition-colors"
        >
          {showFullLedger ? 'Hide full ledger' : 'View All →'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFullLedger ? 'rotate-180' : ''}`} />
        </button>

        {showFullLedger && (
          <div className="border-t border-border">
            <PaymentLedger
              hostelId={hostelId}
              payments={payments}
              paymentsData={paymentsData}
              onRowClick={handleRowClick}
              refetch={refetchPayments}
            />
          </div>
        )}
      </div>

      {/* Modals & Drawers */}
      {selectedObligationId && (
        <Suspense fallback={null}>
          <PaymentDetailDrawer
            obligationId={selectedObligationId}
            hostelId={resolvedHostelIdForObligation || hostelId}
            onClose={() => setSelectedObligationId(null)}
          />
        </Suspense>
      )}

      {showDuesDrawer && (
        <OutstandingDuesDrawer
          hostelId={hostelId}
          dues={overdueList}
          onClose={() => setShowDuesDrawer(false)}
          onCollect={(due) => {
            setShowDuesDrawer(false);
            handleCollect(due);
          }}
        />
      )}

      {recordPayment && (
        <RecordPaymentModal
          hostelId={recordPayment.hostelId}
          context={{
            tenantId: recordPayment.tenantId,
            obligationId: recordPayment.dueId,
            defaultAmount: recordPayment.amount,
            source: recordPayment.tenantId ? 'financial-center' : 'quick-collect',
          }}
          initialTenantData={recordPayment.initialTenantData}
          onClose={() => {
            setRecordPayment(null);
            refetchDues();
            refetchPayments();
          }}
        />
      )}

      {showAddExpense && (
        <Suspense fallback={null}>
          <AddExpenseModal
            categories={EXPENSE_CATEGORIES}
            mode="create"
            loading={createExpenseMutation.isPending}
            onClose={() => setShowAddExpense(false)}
            onSubmit={(body) => createExpenseMutation.mutate(body)}
          />
        </Suspense>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend-v2 && npx tsc -p tsconfig.json --noEmit`
Expected: no errors in `FinancialControlCenter.tsx`.

- [ ] **Step 6: Run the architecture check**

Run: `cd frontend-v2 && npm run check:architecture`
Expected: passes (no raw `fetch`/`axios` were introduced; this task only rearranges existing JSX and imports).

- [ ] **Step 7: Commit**

```bash
git add frontend-v2/src/app/components/views/billing/FinancialControlCenter.tsx
git commit -m "feat(billing): replace Financial Control Center layout with 5-section redesign"
```

---

### Task 4: Delete dead component files

**Files:**
- Delete: `frontend-v2/src/app/components/views/billing/CashPosition.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/CollectionPipeline.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/HealthBar.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/OverdueIntelligence.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/PaymentAttemptsIntelligence.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/RiskZone.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/RoomPerformance.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/SmartFilters.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/TodayPriorities.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/FinancialSummaryStrip.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/AdvancedPaymentTable.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/CashflowCharts.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/FinancialTimeline.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/CashflowForecast.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/CollectionAnalytics.tsx`
- Delete: `frontend-v2/src/app/components/views/billing/ExpenseIntelligence.tsx`

**Interfaces:** None — this task only removes files with zero remaining consumers.

- [ ] **Step 1: Verify zero references before deleting**

Run (from repo root):
```bash
cd frontend-v2/src
for f in CashPosition CollectionPipeline HealthBar OverdueIntelligence PaymentAttemptsIntelligence RiskZone RoomPerformance SmartFilters TodayPriorities FinancialSummaryStrip AdvancedPaymentTable CashflowCharts FinancialTimeline CashflowForecast CollectionAnalytics ExpenseIntelligence; do
  count=$(grep -rl "$f" --include="*.tsx" --include="*.ts" . | grep -v "app/components/views/billing/$f.tsx" | wc -l)
  echo "$f: $count"
done
```
Expected: every line prints `<name>: 0`. If any prints non-zero, stop and investigate that reference before deleting — do not delete a file still imported somewhere.

- [ ] **Step 2: Delete the files**

```bash
cd /home/sp/Desktop/hms
git rm frontend-v2/src/app/components/views/billing/CashPosition.tsx \
       frontend-v2/src/app/components/views/billing/CollectionPipeline.tsx \
       frontend-v2/src/app/components/views/billing/HealthBar.tsx \
       frontend-v2/src/app/components/views/billing/OverdueIntelligence.tsx \
       frontend-v2/src/app/components/views/billing/PaymentAttemptsIntelligence.tsx \
       frontend-v2/src/app/components/views/billing/RiskZone.tsx \
       frontend-v2/src/app/components/views/billing/RoomPerformance.tsx \
       frontend-v2/src/app/components/views/billing/SmartFilters.tsx \
       frontend-v2/src/app/components/views/billing/TodayPriorities.tsx \
       frontend-v2/src/app/components/views/billing/FinancialSummaryStrip.tsx \
       frontend-v2/src/app/components/views/billing/AdvancedPaymentTable.tsx \
       frontend-v2/src/app/components/views/billing/CashflowCharts.tsx \
       frontend-v2/src/app/components/views/billing/FinancialTimeline.tsx \
       frontend-v2/src/app/components/views/billing/CashflowForecast.tsx \
       frontend-v2/src/app/components/views/billing/CollectionAnalytics.tsx \
       frontend-v2/src/app/components/views/billing/ExpenseIntelligence.tsx
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend-v2 && npx tsc -p tsconfig.json --noEmit`
Expected: no errors (no remaining file imports any of the deleted paths).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(billing): remove dead chart/widget components superseded by the redesign"
```

---

### Task 5: Update `docs/obsidian/` per the documentation rule

**Files:**
- Modify: `docs/obsidian/Features.md`
- Modify: `docs/obsidian/Changelog.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update the Features.md row**

In `docs/obsidian/Features.md`, find:
```
| Billing / financial control center | `/billing` | `BillingView` + `app/components/views/billing/*` (~20 widgets: cashflow, collection pipeline, overdue intelligence, payment ledger, room performance) |
```
replace with:
```
| Billing / financial control center | `/billing` | `BillingView` + `FinancialControlCenter.tsx` (Overview tab: Collection Progress, Priority Collections, Smart Insights, Property Finance (all-hostels view only), Recent Transactions with expandable full `PaymentLedger`) + `ExpensesTab` (Expenses Workspace tab) — redesigned 2026-07-18, see [[Changelog]]; most of the older `billing/*` widget set (cashflow/collection-pipeline/overdue-intelligence/room-performance charts) was dead code by this point and was removed |
```

- [ ] **Step 2: Add a Changelog entry**

In `docs/obsidian/Changelog.md`, under `## [Unreleased]` → `### Changed`, add a new bullet (after the existing "Full-codebase documentation audit" bullet):
```
- **2026-07-18**: Financial Control Center (owner Money screen, Overview tab) redesigned from a dense, chart-heavy layout into five focused sections — Collection Progress, Priority Collections, Smart Insights, Property Finance (all-hostels view only), Recent Transactions (last 5, with the existing searchable `PaymentLedger` demoted to an expandable "View All"). New pure-logic module `FinancialControlCenter`'s sibling `financeInsights.ts` computes urgency buckets, today's-collection, per-hostel ranking, and the Smart Insights list — all derived from data already fetched, no backend changes. Removed 12 pre-existing dead widget files (`CashPosition`, `CollectionPipeline`, `HealthBar`, `OverdueIntelligence`, `PaymentAttemptsIntelligence`, `RiskZone`, `RoomPerformance`, `SmartFilters`, `TodayPriorities`, `FinancialSummaryStrip`, `AdvancedPaymentTable`, `CashflowCharts`, `FinancialTimeline`) plus 3 newly-orphaned chart components (`CashflowForecast`, `CollectionAnalytics`, `ExpenseIntelligence`) whose only consumer was the removed charts section. See [[Features]].
```

- [ ] **Step 3: Commit**

```bash
git add docs/obsidian/Features.md docs/obsidian/Changelog.md
git commit -m "docs: update obsidian vault for Financial Control Center redesign"
```

---

### Task 6: Full verification

**Files:** None modified — verification only.

**Interfaces:** None.

- [ ] **Step 1: Run the full build**

Run: `cd frontend-v2 && npm run build`
Expected: succeeds — `check:architecture` passes, `vite build` completes, branding check passes.

- [ ] **Step 2: Start the dev server**

Run: `cd frontend-v2 && npm run dev`
Expected: starts on the printed local URL without errors.

- [ ] **Step 3: Manual verification — "All Hostels" view**

In a browser, navigate to the Money/Billing screen with the hostel selector on "All Hostels". Confirm:
- Collection Progress hero shows a progress bar, Collected/Pending/Today's Collection/Target, and the Cash/UPI text line.
- Priority Collections shows at most 3 cards, each with an urgency badge (🔴/🟠/🟡/⚪) matching its days-late value, and "View All Dues (N) →" opens the existing drawer.
- Smart Insights shows at most 4 lines (or the single "✓ All caught up" fallback if nothing applies).
- Property Finance is visible (since "All Hostels" is selected and there are ≥2 hostels) with one card per hostel, sorted best collection % to worst.
- Recent Transactions shows at most 5 rows; clicking "View All →" expands the full searchable `PaymentLedger` below it; clicking again collapses it.
- Record Payment, Add Expense, Remind, and Export buttons in the header all still work as before.

- [ ] **Step 4: Manual verification — single hostel view**

Switch the hostel selector to one specific hostel. Confirm:
- Property Finance section is **not rendered** (single-hostel view has nothing to compare).
- All other sections still render correctly and reflect only that hostel's data.
- If that hostel has zero overdue dues, Priority Collections shows its empty state and Smart Insights either omits pace/recovery insights (if `expectedVal` is 0) or shows the ones that do apply.

- [ ] **Step 5: Report results**

If any manual check fails, fix the underlying issue in the relevant earlier task's file before proceeding — do not patch around it here. Once all checks pass, this plan is complete.
