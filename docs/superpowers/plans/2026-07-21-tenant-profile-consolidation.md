# Tenant Profile (Owner Side) UI/UX Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce and de-duplicate the owner-facing Tenant Profile page (`TenantProfilePage.tsx`) — replace its false-tab scroll-nav with real tabs, merge three overlapping activity/ledger feeds into one filterable timeline, merge two overlapping risk/insight cards into one, and consolidate eight scattered action buttons into one action bar — without touching any backend logic.

**Architecture:** Pure frontend recomposition in `frontend-v2`. Every merged/deleted component (`TenantHealthCard`, `OwnerInsights`, `FinancialActivity`, `LedgerStatement`, `ActivityTimeline`, `FinancialWorkspaceNav`) has exactly one consumer — `TenantProfilePage.tsx` — confirmed via `grep -rl` across `frontend-v2/src`, so this is safe to restructure without cross-page impact. `FinancialActivityCard.tsx`, `groupFinancialActivity.ts`, and `financialColors.ts` are kept and reused, not reimplemented. No new API calls, query keys, or backend routes.

**Tech Stack:** Vite + React 19 + TypeScript, TanStack Query, Tailwind, Radix-based UI primitives (`@/app/components/ui/tabs`, `@/app/components/ui/dropdown-menu`) already present in this codebase.

## Global Constraints

- No backend changes of any kind — this plan touches only `frontend-v2/src/features/tenants/**` and `frontend-v2/src/app/components/modals` is untouched.
- `frontend-v2` has no test suite. Verification per task is: code read-back, then `npm run build` from `frontend-v2/` (runs `check:architecture`, `vite build`, branding check — all three must pass), then a manual browser check of the specific behavior the task changed (per `CLAUDE.md`: "test the feature in a browser before reporting complete", not just a build-pass claim).
- All new/modified frontend code goes through `@lib/api-client`-backed services only — never raw `fetch()`/`axios` (no new data-fetching is introduced by this plan, so this mainly means: don't invent a new fetch call where an existing hook/service already provides the data).
- Per `CLAUDE.md`'s Documentation Rules, this is a "significant refactoring" — `docs/obsidian/Frontend.md`, `docs/obsidian/Features.md`, and `docs/obsidian/Changelog.md` must be updated in the same body of work (done in Task 5), including fixing existing passages in `Features.md` that reference files/wiring this plan deletes or moves.
- Follow existing code style exactly: Tailwind class patterns, `lucide-react` icons, the `fmt`/`money`/`date` helper conventions already used in this file tree — do not introduce a new styling system or component library.

---

## File Structure

```
frontend-v2/src/features/tenants/components/
  profile/
    RiskComplianceCard.tsx           [create — Task 1]
    UnifiedActivityTimeline.tsx      [create in Task 3, extended in Task 4]
    DocumentsTab.tsx                 [create — Task 4]
    TenantProfilePage.tsx            [modify — Tasks 1, 2, 3, 4]
    TenantHealthCard.tsx             — N/A (lives in score/, see below)
    OwnerInsights.tsx                [delete — Task 1]
    FinancialActivity.tsx            — N/A (lives in financial/, see below)
    LedgerStatement.tsx              — N/A (lives in financial/, see below)
    ActivityTimeline.tsx             [delete — Task 4]
    FinancialWorkspaceNav.tsx        [delete — Task 3]
  score/
    TenantHealthCard.tsx             [delete — Task 1]
  financial/
    PrimaryActionsBar.tsx            [modify — Task 2]
    FinancialActivityCard.tsx        [modify — Task 3, add optional balanceAfter prop]
    FinancialActivity.tsx            [delete — Task 3]
    LedgerStatement.tsx              [delete — Task 3]
    DocumentsHub.tsx                 [unchanged — reused inside DocumentsTab]
  documents/
    VerificationPanel.tsx            [unchanged — reused inside DocumentsTab]

docs/obsidian/
  Frontend.md, Features.md, Changelog.md   [modify — Task 5]
```

---

### Task 1: `RiskComplianceCard` — merge `TenantHealthCard` + `OwnerInsights`

**Files:**
- Create: `frontend-v2/src/features/tenants/components/profile/RiskComplianceCard.tsx`
- Delete: `frontend-v2/src/features/tenants/components/score/TenantHealthCard.tsx`
- Delete: `frontend-v2/src/features/tenants/components/profile/OwnerInsights.tsx`
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Produces: `RiskComplianceCard({ score, hasAgreement, documentStatus, overdueDays, depositStatus, loading })` — a single card combining the composite health score/level/checklist (from `TenantHealthCard`) with curated narrative insights (from `OwnerInsights`, with the agreement/KYC insights dropped since the checklist already shows that).

Both `TenantHealthCard` (props `grade`, `trend`) and `OwnerInsights` (props `outstandingAmount`, `joinedDate`) currently declare props that are **never read anywhere in either component's body** — confirmed by reading both files in full. `RiskComplianceCard` drops all four: this is real dead-prop removal, not a guess.

- [ ] **Step 1: Create `RiskComplianceCard.tsx`**

```tsx
// frontend-v2/src/features/tenants/components/profile/RiskComplianceCard.tsx
import { ShieldCheck, ShieldAlert, Loader2, FileCheck2, UserCheck, AlertTriangle, TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Info, Sparkles } from 'lucide-react';

interface RiskComplianceCardProps {
  score?: number | null;
  hasAgreement: boolean;
  documentStatus: string;
  overdueDays: number;
  depositStatus: string;
  loading?: boolean;
}

interface Insight {
  type: 'critical' | 'warning' | 'success' | 'info';
  message: string;
  icon: typeof TrendingDown;
}

function insightColors(type: Insight['type']): string {
  switch (type) {
    case 'critical':
      return 'bg-rose-500/10 text-rose-600 border-rose-500/25 dark:bg-rose-950/20 dark:text-rose-400';
    case 'warning':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/25 dark:bg-amber-950/20 dark:text-amber-400';
    case 'success':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-950/20 dark:text-emerald-400';
    default:
      return 'bg-blue-500/10 text-blue-600 border-blue-500/25 dark:bg-blue-950/20 dark:text-blue-400';
  }
}

/**
 * Replaces the former TenantHealthCard + OwnerInsights pair, which
 * independently derived and displayed the same agreement/KYC/score signals —
 * one as a composite score + checklist, the other as prose warnings restating
 * the same checklist items. The checklist below is the single source of
 * truth for Agreement/KYC status; narrative insights here are only the ones
 * that add information the checklist doesn't already state (score-derived
 * risk, overdue alert, deposit status) — agreement-missing and KYC-missing
 * insights are deliberately NOT repeated here.
 */
export function RiskComplianceCard({
  score,
  hasAgreement,
  documentStatus,
  overdueDays,
  depositStatus,
  loading = false,
}: RiskComplianceCardProps) {
  if (loading) {
    return (
      <div className="p-4 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-center h-24">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
      </div>
    );
  }

  const baseScore = score ?? 75;
  let compositeScore = baseScore;
  if (!hasAgreement) compositeScore -= 15;
  if (documentStatus === 'MISSING') compositeScore -= 15;
  else if (documentStatus === 'PENDING') compositeScore -= 5;
  compositeScore = Math.max(10, Math.min(100, compositeScore));

  let healthLevel: 'Excellent' | 'Good' | 'Risk' | 'Critical' = 'Good';
  let healthBg = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-950/20 dark:text-emerald-400';
  let healthText = 'Payer reliability is high, all core configurations verified.';

  if (compositeScore >= 90) {
    healthLevel = 'Excellent';
  } else if (compositeScore >= 70) {
    healthLevel = 'Good';
    healthBg = 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-950/20 dark:text-blue-400';
    healthText = 'Minor document or verification checklist pending.';
  } else if (compositeScore >= 45) {
    healthLevel = 'Risk';
    healthBg = 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-400';
    healthText = 'Elevated default or non-compliance risk. Active follow-up needed.';
  } else {
    healthLevel = 'Critical';
    healthBg = 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-950/20 dark:text-rose-400';
    healthText = 'Critical status. Highly delayed payments or major agreement issues.';
  }

  const insights: Insight[] = [];

  if (score !== undefined && score !== null) {
    if (score < 60) {
      insights.push({ type: 'critical', message: 'High risk of payment default. Prioritize immediate collection.', icon: TrendingDown });
    } else if (score >= 85) {
      insights.push({ type: 'success', message: 'Excellent payment reliability. Standard auto-reminders are sufficient.', icon: TrendingUp });
    } else if (score < 75) {
      insights.push({ type: 'warning', message: 'Moderate risk. Often pays only after repeated WhatsApp reminders.', icon: Info });
    }
  }

  if (overdueDays > 15) {
    insights.push({ type: 'critical', message: `Tenant is ${overdueDays} days overdue. Contact guardian if tenant does not respond.`, icon: AlertCircle });
  }

  if (depositStatus === 'PENDING') {
    insights.push({ type: 'warning', message: 'Refundable security deposit is unpaid. Restrict room movement.', icon: AlertCircle });
  } else if (depositStatus === 'WAIVED') {
    insights.push({ type: 'info', message: 'Security deposit waived by owner. (₹0 deposit arrangement active).', icon: CheckCircle2 });
  }

  if (insights.length === 0) {
    insights.push({ type: 'info', message: 'All billing configurations and verification details are in order.', icon: CheckCircle2 });
  }

  return (
    <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${healthBg}`}>
            {healthLevel === 'Excellent' || healthLevel === 'Good' ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Risk &amp; Compliance</p>
            <p className="text-lg font-black text-foreground leading-tight">
              {compositeScore}
              <span className="text-xs font-semibold text-muted-foreground">/100</span>
            </p>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${healthBg}`}>{healthLevel}</span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{healthText}</p>

      <div className="grid grid-cols-3 gap-2.5 pt-2.5 border-t border-border/60 text-[10px]">
        <div className="flex flex-col gap-1 items-center justify-center p-2 rounded-xl bg-secondary/50 border border-border/50 text-center">
          <UserCheck className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-foreground">Payment Rate</span>
          <span className="text-muted-foreground font-medium">{baseScore}%</span>
        </div>
        <div className="flex flex-col gap-1 items-center justify-center p-2 rounded-xl bg-secondary/50 border border-border/50 text-center">
          <FileCheck2 className={`w-4 h-4 ${hasAgreement ? 'text-emerald-500' : 'text-rose-500'}`} />
          <span className="font-semibold text-foreground">Agreement</span>
          <span className="text-muted-foreground font-medium">{hasAgreement ? 'Signed' : 'Missing'}</span>
        </div>
        <div className="flex flex-col gap-1 items-center justify-center p-2 rounded-xl bg-secondary/50 border border-border/50 text-center">
          <AlertTriangle className={`w-4 h-4 ${documentStatus === 'VERIFIED' ? 'text-emerald-500' : 'text-amber-500'}`} />
          <span className="font-semibold text-foreground">KYC Verification</span>
          <span className="text-muted-foreground font-medium">
            {documentStatus === 'VERIFIED' ? 'Verified' : documentStatus === 'PENDING' ? 'Pending' : 'Missing'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span>Insights</span>
        </div>
        {insights.map((insight, idx) => {
          const Icon = insight.icon;
          return (
            <div key={idx} className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed font-medium ${insightColors(insight.type)}`}>
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{insight.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `TenantProfilePage.tsx`**

Replace the imports:
```ts
import { TenantHealthCard } from '@features/tenants/components/score/TenantHealthCard';
import { OwnerInsights } from '@features/tenants/components/profile/OwnerInsights';
```
with:
```ts
import { RiskComplianceCard } from '@features/tenants/components/profile/RiskComplianceCard';
```

Replace the "Row 2: Insights Grid & Private Notes" block:
```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-5">
  <TenantHealthCard
    score={tenantScore?.score ?? 80}
    grade={tenantScore?.grade ?? 'GOOD'}
    trend={tenantScore?.trend ?? 'STABLE'}
    hasAgreement={Boolean(allocations?.length > 0)}
    documentStatus={String(compliance.document_verification_status ?? 'MISSING').toUpperCase()}
  />

  <OwnerInsights
    score={tenantScore?.score ?? null}
    overdueDays={overdueDays}
    outstandingAmount={outstandingAmount}
    depositStatus={securityDepositAmount === 0 ? 'WAIVED' : 'PAID'}
    hasAgreement={Boolean(allocations?.length > 0)}
    documentStatus={String(compliance.document_verification_status ?? 'MISSING').toUpperCase()}
    joinedDate={date(tenant.joined_on ?? overview.joined_at)}
  />

  <PrivateNotes tenantId={tenantId} />
</div>
```
with:
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
  <RiskComplianceCard
    score={tenantScore?.score ?? 80}
    hasAgreement={Boolean(allocations?.length > 0)}
    documentStatus={String(compliance.document_verification_status ?? 'MISSING').toUpperCase()}
    overdueDays={overdueDays}
    depositStatus={securityDepositAmount === 0 ? 'WAIVED' : 'PAID'}
  />

  <PrivateNotes tenantId={tenantId} />
</div>
```
(Grid goes from `md:grid-cols-3` to `md:grid-cols-2` since there are now 2 cards, not 3.)

- [ ] **Step 3: Delete the old files**

```bash
git rm frontend-v2/src/features/tenants/components/score/TenantHealthCard.tsx
git rm frontend-v2/src/features/tenants/components/profile/OwnerInsights.tsx
```

- [ ] **Step 4: Verify**

Run from `frontend-v2/`: `npm run build` — expected pass (architecture check, vite build, branding check).

Then start the dev server (`npm run dev`) and open any tenant's profile page in a browser: confirm exactly 2 cards render where there were 3 (Risk & Compliance, Private Notes), the score/level/checklist match what the old Composite Tenant Health card showed, and the insights list shows only score/overdue/deposit-derived messages (no "Active agreement missing" / "Mandatory KYC documentation is missing" lines, since the checklist row above already covers those).

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/features/tenants/components/profile/RiskComplianceCard.tsx frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx
git commit -m "feat(tenant-profile): merge Tenant Health + Owner Insights into RiskComplianceCard"
```

---

### Task 2: Consolidate 8 action buttons into `PrimaryActionsBar`

**Files:**
- Modify: `frontend-v2/src/features/tenants/components/financial/PrimaryActionsBar.tsx`
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Consumes: existing `@/app/components/ui/dropdown-menu` (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`) — already present in this codebase, not a new dependency.
- Produces: `PrimaryActionsBar` gains four new props (`onRequestChange`, `requestChangeLabel`, `onChangeRent`, `canChangeRent`, `onCheckout`) alongside its five existing ones. Desktop: `Receive Payment` stays the sole emphasized button; `Create Charge`/`Create Rent`/`View Receipts` stay as visible secondary buttons; `Share Payment Link`, the Request-Change/Edit-Details action, `Change Rent` (only when `canChangeRent`), and `Check-out / Exit` move into a "More" dropdown menu. Mobile: unchanged bottom-sheet mechanism, now listing all 8 actions.

- [ ] **Step 1: Rewrite `PrimaryActionsBar.tsx`**

```tsx
// frontend-v2/src/features/tenants/components/financial/PrimaryActionsBar.tsx
import { useState } from 'react';
import { IndianRupee, ReceiptText, CalendarPlus, Share2, FileStack, ChevronDown, X, MoreHorizontal, FileCheck2, TrendingUp, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { paymentService } from '@features/payments/api';
import { hmsToast } from '@lib/toast';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/app/components/ui/dropdown-menu';

interface PrimaryAction {
  key: string;
  label: string;
  icon: typeof IndianRupee;
  onClick: () => void;
  emphasis?: boolean;
}

interface PrimaryActionsBarProps {
  tenantId: string;
  onReceivePayment: () => void;
  onCreateCharge: () => void;
  onCreateRent: () => void;
  onViewReceipts: () => void;
  onRequestChange: () => void;
  requestChangeLabel: string;
  onChangeRent: () => void;
  canChangeRent: boolean;
  onCheckout: () => void;
  receiveLabel?: string;
}

export function PrimaryActionsBar({
  tenantId,
  onReceivePayment,
  onCreateCharge,
  onCreateRent,
  onViewReceipts,
  onRequestChange,
  requestChangeLabel,
  onChangeRent,
  canChangeRent,
  onCheckout,
  receiveLabel = 'Receive Payment',
}: PrimaryActionsBarProps) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSharePaymentLink = async () => {
    try {
      const res = await paymentService.generatePayLink({ tenantId });
      const paymentLink = res.url;
      window.open(`https://wa.me/?text=${encodeURIComponent(`Here is your payment link: ${paymentLink}`)}`, '_blank');
      toast.success('Payment link composed in WhatsApp');
    } catch (e: any) {
      hmsToast.error(e, 'Generate payment link');
    }
  };

  const secondaryActions: PrimaryAction[] = [
    { key: 'charge', label: 'Create Charge', icon: ReceiptText, onClick: onCreateCharge },
    { key: 'rent', label: 'Create Rent', icon: CalendarPlus, onClick: onCreateRent },
    { key: 'receipts', label: 'View Receipts', icon: FileStack, onClick: onViewReceipts },
  ];

  const overflowActions: PrimaryAction[] = [
    { key: 'link', label: 'Share Payment Link', icon: Share2, onClick: handleSharePaymentLink },
    { key: 'request-change', label: requestChangeLabel, icon: FileCheck2, onClick: onRequestChange },
    ...(canChangeRent ? [{ key: 'change-rent', label: 'Change Rent', icon: TrendingUp, onClick: onChangeRent }] : []),
    { key: 'checkout', label: 'Check-out / Exit', icon: LogOut, onClick: onCheckout },
  ];

  const allActionsForSheet: PrimaryAction[] = [
    { key: 'receive', label: receiveLabel, icon: IndianRupee, onClick: onReceivePayment, emphasis: true },
    ...secondaryActions,
    ...overflowActions,
  ];

  if (isMobile) {
    return (
      <div id="fin-actions" className="scroll-mt-20">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-accent text-accent-foreground text-sm font-bold active:scale-98 transition-transform shadow-sm"
        >
          <IndianRupee className="w-4 h-4" />
          <span>Actions</span>
          <ChevronDown className="w-4 h-4" />
        </button>

        {sheetOpen && (
          <div className="fixed inset-0 z-50 flex items-end bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="w-full rounded-t-3xl border-t border-border bg-card p-4 pb-6 shadow-2xl animate-in slide-in-from-bottom duration-200 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-foreground">Actions</h3>
                <button type="button" onClick={() => setSheetOpen(false)} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {allActionsForSheet.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => {
                      setSheetOpen(false);
                      action.onClick();
                    }}
                    className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold active:scale-98 transition-transform ${
                      action.emphasis ? 'bg-accent text-accent-foreground' : 'bg-secondary text-foreground border border-border'
                    }`}
                  >
                    <action.icon className="w-4 h-4" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="fin-actions" className="flex flex-wrap gap-2 scroll-mt-20">
      <button
        type="button"
        onClick={onReceivePayment}
        className="flex-1 min-w-[150px] flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm bg-accent text-accent-foreground hover:bg-accent/90"
      >
        <IndianRupee className="w-4 h-4" />
        <span>{receiveLabel}</span>
      </button>

      {secondaryActions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onClick}
          className="flex-1 min-w-[150px] flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm bg-secondary text-foreground border border-border hover:bg-secondary/80"
        >
          <action.icon className="w-4 h-4" />
          <span>{action.label}</span>
        </button>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm bg-secondary text-foreground border border-border hover:bg-secondary/80"
          >
            <MoreHorizontal className="w-4 h-4" />
            <span>More</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {overflowActions.map((action) => (
            <DropdownMenuItem key={action.key} onSelect={action.onClick} className="gap-2 cursor-pointer">
              <action.icon className="w-4 h-4" />
              <span>{action.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

Note: `DropdownMenuItem` uses `onSelect` (Radix's item-activation event), not `onClick` — this is the correct, idiomatic way to wire an action to a Radix dropdown item; using `onClick` alone can behave inconsistently with the menu's auto-close/keyboard-navigation handling. Verify this fires correctly in Step 4's browser check.

- [ ] **Step 2: Wire the extra props and remove the two blocks it replaces, in `TenantProfilePage.tsx`**

Replace the "Core Action Dashboard" card's inner content (inside the `lg:col-span-2` div, still alongside `CommunicationCenter` in the same grid row) — replace this entire block:
```tsx
<div className="lg:col-span-2">
  <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-3">
    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1.5">
      <Settings className="w-4 h-4 text-accent" />
      Core Action Dashboard
    </span>
    <div className="flex flex-wrap gap-2">
      {status.toUpperCase() === 'ACTIVE' ? (
        <button
          type="button"
          onClick={() => setShowChangeDrawer(true)}
          className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4.5 py-3 rounded-xl bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 active:scale-95 transition-all border border-border"
        >
          <FileCheck2 className="w-4 h-4 text-accent" />
          <span>{personalInfoAction?.label ?? 'Request Change'}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowEditInvite(true)}
          className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4.5 py-3 rounded-xl bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 active:scale-95 transition-all border border-border"
        >
          <Send className="w-4 h-4 text-muted-foreground" />
          <span>Edit Details</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setIsStayExpanded(true);
          setTimeout(() => {
            document.getElementById('stay-details-section')?.scrollIntoView({ behavior: 'smooth' });
          }, 100);
        }}
        className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4.5 py-3 rounded-xl bg-rose-50/50 hover:bg-rose-50 text-rose-600 dark:bg-rose-950/10 dark:hover:bg-rose-950/20 dark:text-rose-400 text-xs font-semibold active:scale-95 transition-all border border-rose-500/20"
      >
        <LogOut className="w-4 h-4" />
        <span>Check-out / Exit</span>
      </button>
    </div>
  </div>
</div>
```
with:
```tsx
<div className="lg:col-span-2">
  <PrimaryActionsBar
    tenantId={tenantId}
    onReceivePayment={() => handleOpenReceivePayment()}
    onCreateCharge={() => setObligationModal({ mode: 'create' })}
    onCreateRent={() => setObligationModal({ mode: 'create', initialValues: { obligationType: 'RENT' } })}
    onViewReceipts={() => handleNavigate('fin-documents')}
    receiveLabel={findAction('PAYMENT_RECEIVE')?.label}
    requestChangeLabel={status.toUpperCase() === 'ACTIVE' ? (personalInfoAction?.label ?? 'Request Change') : 'Edit Details'}
    onRequestChange={() => (status.toUpperCase() === 'ACTIVE' ? setShowChangeDrawer(true) : setShowEditInvite(true))}
    canChangeRent={status.toUpperCase() === 'ACTIVE'}
    onChangeRent={() => setShowChangeRent(true)}
    onCheckout={() => {
      setIsStayExpanded(true);
      setTimeout(() => {
        document.getElementById('stay-details-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }}
  />
</div>
```
(`onCheckout`'s body is temporary here — it still targets the old `isStayExpanded`/`#stay-details-section` mechanism, which still exists at this point in the plan. Task 4 replaces this body once Stay becomes a tab — don't forget that follow-up, it's called out explicitly in Task 4 Step 4.)

Now delete the old **"§2 Primary Actions"** block entirely (this was the previous separate `<PrimaryActionsBar>` render call plus the floating Change Rent button, both now folded into the bar above):
```tsx
{/* §2 Primary Actions */}
<PrimaryActionsBar
  tenantId={tenantId}
  onReceivePayment={() => handleOpenReceivePayment()}
  onCreateCharge={() => setObligationModal({ mode: 'create' })}
  onCreateRent={() => setObligationModal({ mode: 'create', initialValues: { obligationType: 'RENT' } })}
  onViewReceipts={() => handleNavigate('fin-documents')}
  receiveLabel={findAction('PAYMENT_RECEIVE')?.label}
/>

{/* Change Rent entry point — owner-only, identity-confirmed, month-scoped repricing (see Business-Rules.md) */}
{status.toUpperCase() === 'ACTIVE' && (
  <div className="flex justify-end -mt-2">
    <button
      type="button"
      onClick={() => setShowChangeRent(true)}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-secondary text-foreground text-xs font-semibold border border-border hover:bg-secondary/80 active:scale-95 transition-all"
    >
      <TrendingUp className="w-3.5 h-3.5 text-accent" />
      <span>Change Rent</span>
    </button>
  </div>
)}
```
Delete this whole block — no replacement, the actions are already in the bar rendered in Row 1.

Check whether `Settings`, `Send`, `TrendingUp`, and `FileCheck2` (imported at the top from `lucide-react`) are referenced anywhere else in the file after this deletion (`grep -n "Settings\|Send\|TrendingUp\|FileCheck2" TenantProfilePage.tsx`) — `FileCheck2` in particular is also used by the "KYC Verification & Documents" card header, which isn't deleted until Task 4, so it will likely still show a hit at this point; re-check it again at the end of Task 4. Remove any of the four from the top import list only once the grep shows zero remaining uses. `LogOut` stays imported regardless — it's also used in the Stay section's "Move-Out Settlement Workflow" heading.

- [ ] **Step 3: Verify**

Run from `frontend-v2/`: `npm run build` — expected pass.

Then in the dev server: open a tenant's profile. Confirm: one action bar near the top (next to Communication Center) with "Receive Payment" prominent, "Create Charge"/"Create Rent"/"View Receipts" visible, and a "More" button. Click "More" — confirm all four overflow items appear (Share Payment Link, Request Change/Edit Details, Change Rent only if tenant is ACTIVE, Check-out/Exit) and each one still opens its correct existing modal/drawer/section. Confirm the old separate "Core Action Dashboard" card and the old floating "Change Rent" button are both gone, and there is no second/duplicate action bar further down the page.

- [ ] **Step 4: Commit**

```bash
git add frontend-v2/src/features/tenants/components/financial/PrimaryActionsBar.tsx frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx
git commit -m "feat(tenant-profile): consolidate 8 action buttons into one PrimaryActionsBar with overflow menu"
```

---

### Task 3: Real tabs (Obligations / Activity / Documents) + `UnifiedActivityTimeline` v1 (merges Financial Activity + Ledger)

**Files:**
- Modify: `frontend-v2/src/features/tenants/components/financial/FinancialActivityCard.tsx`
- Create: `frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx`
- Delete: `frontend-v2/src/features/tenants/components/financial/FinancialActivity.tsx`
- Delete: `frontend-v2/src/features/tenants/components/financial/LedgerStatement.tsx`
- Delete: `frontend-v2/src/features/tenants/components/profile/FinancialWorkspaceNav.tsx`
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Consumes: `groupFinancialActivity` (`@features/tenants/utils/groupFinancialActivity`, unchanged), `TimelineEvent` type (`@features/tenants/utils/financialColors`, unchanged), `FinancialActivityCard` (extended with one new optional prop this task adds).
- Produces: `UnifiedActivityTimeline({ events, ledgerEntries, isLoading, onDownloadReceipt, onViewObligation, onCorrectPayment })` — this task's version merges what `FinancialActivity` and `LedgerStatement` showed (financial events + ledger running balance) into one filterable feed. Task 4 extends this same component with non-financial events; do not treat this version as final.

`Ledger`'s `balance_after` (previously only visible in the standalone Ledger & Accounting Statement section) is preserved by cross-referencing each `LEDGER_CREDIT`/`LEDGER_DEBIT` `TimelineEvent`'s `references.ledger_entry_id` against `advance.entries` (the exact same data `LedgerStatement` already consumed) and threading the matched `balance_after` into `FinancialActivityCard`'s new optional prop — confirmed this is a valid cross-reference: `TimelineEvent.references.ledger_entry_id` and each ledger entry's `id` are the same identifier space (both ultimately point at `tenant_financial_ledger` rows).

- [ ] **Step 1: Add an optional `balanceAfter` prop to `FinancialActivityCard.tsx`**

In `frontend-v2/src/features/tenants/components/financial/FinancialActivityCard.tsx`, add to the props interface:
```ts
interface FinancialActivityCardProps {
  entry: FinancialActivityEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onDownloadReceipt?: (paymentId: string) => void;
  onViewObligation?: (obligationId: string) => void;
  onCorrectPayment?: (paymentId: string) => void;
  balanceAfter?: number | null;
}
```
and to the component signature:
```ts
export function FinancialActivityCard({
  entry,
  isExpanded,
  onToggle,
  onDownloadReceipt,
  onViewObligation,
  onCorrectPayment,
  balanceAfter,
}: FinancialActivityCardProps) {
```
Then, inside the expanded detail block, right after the `<p className="text-muted-foreground">{primary.summary}</p>` line, add:
```tsx
{balanceAfter != null && (
  <div className="flex justify-between text-[11px]">
    <span className="text-muted-foreground">Balance after this entry</span>
    <span className="font-semibold text-foreground">{fmt(balanceAfter)}</span>
  </div>
)}
```

- [ ] **Step 2: Create `UnifiedActivityTimeline.tsx` (v1)**

```tsx
// frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx
import { useMemo, useState } from 'react';
import { Loader2, ListFilter, Banknote, ReceiptText, Wallet, FileCheck2 } from 'lucide-react';
import { groupFinancialActivity } from '@features/tenants/utils/groupFinancialActivity';
import type { TimelineEvent } from '@features/tenants/utils/financialColors';
import { FinancialActivityCard } from '@features/tenants/components/financial/FinancialActivityCard';

interface LedgerEntry {
  id: string;
  balance_after: number;
}

type FilterCategory = 'all' | 'payments' | 'ledger' | 'obligations' | 'agreement';

const FILTER_CHIPS: { id: FilterCategory; label: string; icon: typeof ListFilter }[] = [
  { id: 'all', label: 'All', icon: ListFilter },
  { id: 'payments', label: 'Payments', icon: Banknote },
  { id: 'ledger', label: 'Ledger', icon: Wallet },
  { id: 'obligations', label: 'Obligations', icon: ReceiptText },
  { id: 'agreement', label: 'Agreement', icon: FileCheck2 },
];

function matchesFilter(event: TimelineEvent, filter: FilterCategory): boolean {
  if (filter === 'all') return true;
  if (filter === 'payments') return event.type === 'PAYMENT_RECORDED' || event.type === 'PAYMENT_GROUP_SETTLED';
  if (filter === 'ledger') return event.type === 'LEDGER_CREDIT' || event.type === 'LEDGER_DEBIT';
  if (filter === 'obligations') return event.type === 'OBLIGATION_CREATED' || event.type === 'OBLIGATION_WAIVED' || event.type === 'OBLIGATION_CANCELLED';
  if (filter === 'agreement') return event.type === 'CHANGE_REQUEST';
  return true;
}

interface UnifiedActivityTimelineProps {
  events: TimelineEvent[];
  ledgerEntries: LedgerEntry[];
  isLoading?: boolean;
  onDownloadReceipt?: (paymentId: string) => void;
  onViewObligation?: (obligationId: string) => void;
  onCorrectPayment?: (paymentId: string) => void;
}

const PAGE_SIZE = 8;

/**
 * Replaces the former Financial Activity + Ledger & Accounting Statement
 * sections, which showed overlapping payment/ledger data in two different
 * formats with two different filter taxonomies. This is the first version
 * (financial + ledger only) — Task 4 extends it with non-financial
 * (KYC/room/system) events and Invitation History.
 */
export function UnifiedActivityTimeline({
  events,
  ledgerEntries,
  isLoading,
  onDownloadReceipt,
  onViewObligation,
  onCorrectPayment,
}: UnifiedActivityTimelineProps) {
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const grouped = useMemo(() => groupFinancialActivity(events), [events]);

  const balanceByLedgerEntryId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of ledgerEntries) map.set(entry.id, entry.balance_after);
    return map;
  }, [ledgerEntries]);

  const filtered = useMemo(
    () => grouped.filter((entry) => matchesFilter(entry.primary, activeFilter)),
    [grouped, activeFilter],
  );

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h3 className="text-sm font-bold text-foreground">Activity</h3>
      </div>

      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {FILTER_CHIPS.map((chip) => {
          const ChipIcon = chip.icon;
          const isSelected = activeFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                setActiveFilter(chip.id);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                isSelected
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/10'
              }`}
            >
              <ChipIcon className="w-3.5 h-3.5" />
              <span>{chip.label}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-10">No activity recorded yet.</p>
      ) : (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1 scrollbar-hide">
          {visible.map((entry) => {
            const isLedger = entry.primary.type === 'LEDGER_CREDIT' || entry.primary.type === 'LEDGER_DEBIT';
            const balanceAfter = isLedger
              ? balanceByLedgerEntryId.get(entry.primary.references.ledger_entry_id ?? '') ?? null
              : null;
            return (
              <FinancialActivityCard
                key={entry.id}
                entry={entry}
                balanceAfter={balanceAfter}
                isExpanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                onDownloadReceipt={onDownloadReceipt}
                onViewObligation={onViewObligation}
                onCorrectPayment={onCorrectPayment}
              />
            );
          })}
          {filtered.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="w-full py-2 text-xs font-semibold text-accent hover:underline"
            >
              Load more ↓
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Replace the tab-related state and the `isMobile`/ternary block in `TenantProfilePage.tsx`**

Remove this line (near the top of the component body):
```ts
const isMobile = useIsMobile();
```
and this state declaration:
```ts
const [mobileTab, setMobileTab] = useState<MobileTab>('obligations');
```
and this type declaration (near the top of the file, outside the component):
```ts
type MobileTab = 'obligations' | 'activity' | 'ledger' | 'documents';
```

Add, inside the component body in their place:
```ts
type TabId = 'obligations' | 'activity' | 'documents';
const [activeTab, setActiveTab] = useState<TabId>('obligations');
```

Replace the `handleNavigate` function:
```ts
const handleNavigate = (section: FinancialSectionId) => {
  const tabForSection: Partial<Record<FinancialSectionId, MobileTab>> = {
    'fin-obligations': 'obligations',
    'fin-activity': 'activity',
    'fin-ledger': 'ledger',
    'fin-documents': 'documents',
  };
  const tab = tabForSection[section];
  if (isMobile && tab) setMobileTab(tab);
  setTimeout(() => {
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, isMobile && tab ? 50 : 0);
};
```
with:
```ts
const handleNavigate = (section: FinancialSectionId) => {
  const tabForSection: Partial<Record<FinancialSectionId, TabId>> = {
    'fin-obligations': 'obligations',
    'fin-activity': 'activity',
    'fin-ledger': 'activity',
    'fin-documents': 'documents',
  };
  const tab = tabForSection[section];
  if (tab) setActiveTab(tab);
};
```
(`fin-ledger` now maps to the `activity` tab since Ledger content lives inside the unified Activity timeline. `CompactFinancialStrip`'s stat tiles still call `onNavigate?.(metric.target)` unchanged — they now switch the real tab instead of scrolling, which is a better experience for the same click.)

Remove the `activitySection` and `ledgerSection` consts:
```ts
const activitySection = (
  <FinancialActivity
    events={financialEvents}
    isLoading={(financialTimeline as any) === undefined}
    onDownloadReceipt={handleDownloadReceipt}
    onViewObligation={() => handleNavigate('fin-obligations')}
    onCorrectPayment={setCorrectingPaymentId}
  />
);

const ledgerSection = (
  <LedgerStatement entries={(advance as any)?.entries ?? []} balance={futureCredit} />
);
```
with:
```ts
const activitySection = (
  <UnifiedActivityTimeline
    events={financialEvents}
    ledgerEntries={(advance as any)?.entries ?? []}
    isLoading={(financialTimeline as any) === undefined}
    onDownloadReceipt={handleDownloadReceipt}
    onViewObligation={() => setActiveTab('obligations')}
    onCorrectPayment={setCorrectingPaymentId}
  />
);
```

Remove the `<FinancialWorkspaceNav onNavigate={handleNavigate} />` render call and its preceding banner comment:
```tsx
{/* ═══════════════════════ FINANCIAL WORKSPACE ═══════════════════════ */}
<FinancialWorkspaceNav onNavigate={handleNavigate} />
```

Replace the `isMobile ? <Tabs>...</Tabs> : <>grid + ledgerSection + documentsSection</>` block:
```tsx
{/* §3 Obligations + §4 Financial Activity */}
{isMobile ? (
  <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as MobileTab)}>
    <TabsList className="w-full overflow-x-auto scrollbar-hide">
      <TabsTrigger value="obligations">Obligations</TabsTrigger>
      <TabsTrigger value="activity">Activity</TabsTrigger>
      <TabsTrigger value="ledger">Ledger</TabsTrigger>
      <TabsTrigger value="documents">Documents</TabsTrigger>
    </TabsList>
    <TabsContent value="obligations">{obligationsSection}</TabsContent>
    <TabsContent value="activity">{activitySection}</TabsContent>
    <TabsContent value="ledger">{ledgerSection}</TabsContent>
    <TabsContent value="documents">{documentsSection}</TabsContent>
  </Tabs>
) : (
  <>
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-5">{obligationsSection}</div>
      <div className="lg:col-span-7">{activitySection}</div>
    </div>
    {ledgerSection}
    {documentsSection}
  </>
)}
```
with:
```tsx
{/* Tabbed detail region — Obligations / Activity / Documents (Stay tab added in Task 4) */}
<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
  <TabsList className="w-full overflow-x-auto scrollbar-hide">
    <TabsTrigger value="obligations">Obligations</TabsTrigger>
    <TabsTrigger value="activity">Activity</TabsTrigger>
    <TabsTrigger value="documents">Documents</TabsTrigger>
  </TabsList>
  <TabsContent value="obligations">{obligationsSection}</TabsContent>
  <TabsContent value="activity">{activitySection}</TabsContent>
  <TabsContent value="documents">{documentsSection}</TabsContent>
</Tabs>
```

Update the imports: remove
```ts
import { FinancialActivity } from '@features/tenants/components/financial/FinancialActivity';
import { LedgerStatement } from '@features/tenants/components/financial/LedgerStatement';
import { FinancialWorkspaceNav } from '@features/tenants/components/profile/FinancialWorkspaceNav';
import { useIsMobile } from '@/app/components/ui/use-mobile';
```
add:
```ts
import { UnifiedActivityTimeline } from '@features/tenants/components/profile/UnifiedActivityTimeline';
```
(Leave `Tabs, TabsList, TabsTrigger, TabsContent` imported from `@/app/components/ui/tabs` — still used, now unconditionally.)

- [ ] **Step 4: Delete the old files**

```bash
git rm frontend-v2/src/features/tenants/components/financial/FinancialActivity.tsx
git rm frontend-v2/src/features/tenants/components/financial/LedgerStatement.tsx
git rm frontend-v2/src/features/tenants/components/profile/FinancialWorkspaceNav.tsx
```

- [ ] **Step 5: Verify**

Run from `frontend-v2/`: `npm run build` — expected pass.

Then in the dev server: open a tenant's profile. Confirm there are now real, clickable tabs (Obligations / Activity / Documents) below the action bar and stat strip, and only the active tab's content is visible at a time (page is visibly shorter). Click "Activity" — confirm payment events, obligation events, and (for a tenant with any ledger credit/debit history) a "Balance after this entry" line appear when a ledger-type card is expanded. Click a stat tile (e.g. "Future Credit") in the strip above — confirm it now switches to the Activity tab instead of scrolling. Confirm the KYC card, Stay Details card, Recent Activity card, and Invitation History card (untouched by this task) still render below the tabs as before — they're addressed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/src/features/tenants/components/financial/FinancialActivityCard.tsx frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx
git commit -m "feat(tenant-profile): replace scroll-nav with real tabs; merge Financial Activity + Ledger into UnifiedActivityTimeline"
```

---

### Task 4: Extend `UnifiedActivityTimeline` with non-financial events + Invitation History; add Documents tab (merge KYC) and Stay tab

**Files:**
- Modify: `frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx`
- Create: `frontend-v2/src/features/tenants/components/profile/DocumentsTab.tsx`
- Delete: `frontend-v2/src/features/tenants/components/profile/ActivityTimeline.tsx`
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Consumes: `activityListService.getList` (`@features/activity/api`, unchanged — same call `ActivityTimeline` already made), `VerificationPanel`/`DocumentsHub` (both unchanged, reused as-is inside `DocumentsTab`).
- Produces: `UnifiedActivityTimeline` gains `hostelId`, `tenantId`, `tenantName`, `joinedOn`, `documents`, `allocations`, `moveOutRequest`, `invitations`, `tenantStatus` props and 3 more filter chips (KYC / Room & Stay / System). `DocumentsTab({ hostelId, tenantId, profileType, photoUrl, documents, documentVerificationStatus, onDocumentsUpdated, onRemindDocuments, onResendRules, onDownloadAcceptanceRecord, hasAgreement, recentPayments, recentChanges, onViewAllChanges })`.

`ActivityTimeline`'s `timelineItems` and `notes` props are **always passed empty/omitted at the current call site** (`timelineItems={[]}`, `notes` not passed at all) — confirmed by reading the current call in `TenantProfilePage.tsx`. Their corresponding event categories ("Billing Obligations & Reminders", "Owner Private Notes") are dead code in practice and are **not** ported into `UnifiedActivityTimeline`. `ActivityTimeline`'s `recentPayments`-derived events are also dropped (not ported) — they duplicated what the financial-event path already shows, which is the specific redundancy this whole plan removes.

- [ ] **Step 1: Rewrite `UnifiedActivityTimeline.tsx` to add non-financial events + invitations**

Replace the entire file with:

```tsx
// frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, ListFilter, Banknote, ReceiptText, Wallet, FileCheck2,
  UserPlus, Bed, FileUp, FileCheck, LogOut, ShieldAlert, Send, Calendar,
  type LucideIcon,
} from 'lucide-react';
import { groupFinancialActivity } from '@features/tenants/utils/groupFinancialActivity';
import type { TimelineEvent } from '@features/tenants/utils/financialColors';
import { FinancialActivityCard } from '@features/tenants/components/financial/FinancialActivityCard';
import { activityListService } from '@features/activity/api';
import { queryKeys } from '@lib/queryKeys';

interface LedgerEntry {
  id: string;
  balance_after: number;
}

type FilterCategory = 'all' | 'payments' | 'ledger' | 'obligations' | 'agreement' | 'kyc' | 'room_stay' | 'system';

const FILTER_CHIPS: { id: FilterCategory; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'All', icon: ListFilter },
  { id: 'payments', label: 'Payments', icon: Banknote },
  { id: 'ledger', label: 'Ledger', icon: Wallet },
  { id: 'obligations', label: 'Obligations', icon: ReceiptText },
  { id: 'agreement', label: 'Agreement', icon: FileCheck2 },
  { id: 'kyc', label: 'KYC', icon: FileCheck },
  { id: 'room_stay', label: 'Room & Stay', icon: Bed },
  { id: 'system', label: 'System', icon: ShieldAlert },
];

function matchesFinancialFilter(event: TimelineEvent, filter: FilterCategory): boolean {
  if (filter === 'payments') return event.type === 'PAYMENT_RECORDED' || event.type === 'PAYMENT_GROUP_SETTLED';
  if (filter === 'ledger') return event.type === 'LEDGER_CREDIT' || event.type === 'LEDGER_DEBIT';
  if (filter === 'obligations') return event.type === 'OBLIGATION_CREATED' || event.type === 'OBLIGATION_WAIVED' || event.type === 'OBLIGATION_CANCELLED';
  if (filter === 'agreement') return event.type === 'CHANGE_REQUEST';
  return false;
}

interface GeneralEvent {
  id: string;
  timestamp: string;
  title: string;
  subtitle?: string;
  category: 'stay' | 'documents' | 'system';
  icon: LucideIcon;
  color: string;
}

function buildGeneralEvents(params: {
  joinedOn?: string;
  allocations: Record<string, any>[];
  documents: Record<string, any>[];
  moveOutRequest?: Record<string, any> | null;
  invitations: Record<string, any>[];
  tenantStatus: string;
  systemLogs: Record<string, any>[];
  tenantId: string;
  tenantName: string;
}): GeneralEvent[] {
  const { joinedOn, allocations, documents, moveOutRequest, invitations, tenantStatus, systemLogs, tenantId, tenantName } = params;
  const list: GeneralEvent[] = [];

  if (joinedOn) {
    const d = new Date(joinedOn);
    if (!isNaN(d.getTime())) {
      list.push({
        id: `join-${joinedOn}`,
        timestamp: d.toISOString(),
        title: 'Joined Hostel & Created Profile',
        subtitle: 'Tenant onboarding initiated',
        category: 'system',
        icon: UserPlus,
        color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
      });
    }
  }

  allocations.forEach((alloc, idx) => {
    const createdDate = new Date(alloc.created_at ?? alloc.assigned_at);
    if (!isNaN(createdDate.getTime())) {
      list.push({
        id: `alloc-in-${idx}-${createdDate.getTime()}`,
        timestamp: createdDate.toISOString(),
        title: `Room Allocation: Room ${alloc.room_no || 'Assigned'}`,
        subtitle: `Checked in to floor ${alloc.floor ?? '—'} · Rent: ₹${(alloc.monthly_rent ?? 0).toLocaleString('en-IN')}`,
        category: 'stay',
        icon: Bed,
        color: 'text-accent bg-accent/10 border-accent/20',
      });
    }
    if (alloc.vacated_at) {
      const vacatedDate = new Date(alloc.vacated_at);
      if (!isNaN(vacatedDate.getTime())) {
        list.push({
          id: `alloc-out-${idx}-${vacatedDate.getTime()}`,
          timestamp: vacatedDate.toISOString(),
          title: `Vacated Room ${alloc.room_no}`,
          subtitle: 'Checked out / changed room allocation',
          category: 'stay',
          icon: LogOut,
          color: 'text-zinc-600 bg-zinc-500/10 border-zinc-500/20',
        });
      }
    }
  });

  documents.forEach((doc, idx) => {
    const createdDate = new Date(doc.created_at);
    const docTypeLabel = String(doc.doc_type ?? doc.type ?? 'Document').replace(/_/g, ' ');
    if (!isNaN(createdDate.getTime())) {
      list.push({
        id: `doc-upload-${idx}-${createdDate.getTime()}`,
        timestamp: createdDate.toISOString(),
        title: `${docTypeLabel} Submitted`,
        subtitle: 'Document uploaded for verification',
        category: 'documents',
        icon: FileUp,
        color: 'text-sky-600 bg-sky-500/10 border-sky-500/20',
      });
    }
    const status = String(doc.document_status ?? doc.status ?? '').toUpperCase();
    if (status === 'APPROVED' || doc.is_verified === true) {
      const verifiedDate = new Date(doc.updated_at ?? doc.created_at);
      if (!isNaN(verifiedDate.getTime())) {
        list.push({
          id: `doc-verify-${idx}-${verifiedDate.getTime()}`,
          timestamp: verifiedDate.toISOString(),
          title: `${docTypeLabel} Approved`,
          subtitle: 'Document verified and marked active by hostel owner',
          category: 'documents',
          icon: FileCheck,
          color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
        });
      }
    }
  });

  if (moveOutRequest) {
    const reqDate = new Date(moveOutRequest.created_at ?? moveOutRequest.requested_at);
    if (!isNaN(reqDate.getTime())) {
      list.push({
        id: 'move-out-request-timeline',
        timestamp: reqDate.toISOString(),
        title: 'Move-out Notice Submitted',
        subtitle: `Requested vacating date: ${moveOutRequest.vacating_date ? new Date(moveOutRequest.vacating_date).toLocaleDateString('en-IN') : 'Not specified'}`,
        category: 'stay',
        icon: LogOut,
        color: 'text-rose-600 bg-rose-500/10 border-rose-500/20',
      });
    }
  }

  invitations.forEach((invite, index) => {
    const createdDate = new Date(invite.created_at);
    if (!isNaN(createdDate.getTime())) {
      const isActive = index === 0;
      const label = isActive
        ? tenantStatus === 'ACTIVE'
          ? 'Invitation Accepted'
          : tenantStatus === 'CANCELLED'
            ? 'Invitation Cancelled'
            : 'Invitation Sent'
        : 'Invitation Superseded';
      list.push({
        id: `invitation-${invite.id}`,
        timestamp: createdDate.toISOString(),
        title: label,
        subtitle: `Room ${invite.room?.room_no || 'Unassigned'} · Rent ₹${Number(invite.monthly_rent ?? 0).toLocaleString('en-IN')}`,
        category: 'system',
        icon: Send,
        color: isActive ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' : 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20',
      });
    }
  });

  const filteredLogs = systemLogs.filter(
    (e) => String(e.tenant_id ?? '') === tenantId || String(e.tenant_name ?? '').toLowerCase().includes(tenantName.toLowerCase()),
  );
  filteredLogs.forEach((log, idx) => {
    const logDate = new Date(log.created_at);
    if (!isNaN(logDate.getTime())) {
      const logMessage = String(log.detail ?? log.message ?? log.type ?? '');
      // Payments and onboarding are already represented by the financial-event
      // path and the synthetic "Joined Hostel" entry above — skip the
      // duplicate system-log line instead of showing the same fact twice.
      if (logMessage.toLowerCase().includes('payment')) return;
      if (logMessage.toLowerCase().includes('onboard') && joinedOn) return;
      list.push({
        id: `system-log-${idx}-${logDate.getTime()}`,
        timestamp: logDate.toISOString(),
        title: logMessage,
        subtitle: 'System logged event',
        category: 'system',
        icon: ShieldAlert,
        color: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20',
      });
    }
  });

  return list;
}

type UnifiedEntry =
  | { kind: 'financial'; timestamp: string; financial: ReturnType<typeof groupFinancialActivity>[number] }
  | { kind: 'general'; timestamp: string; general: GeneralEvent };

interface UnifiedActivityTimelineProps {
  events: TimelineEvent[];
  ledgerEntries: LedgerEntry[];
  isLoading?: boolean;
  onDownloadReceipt?: (paymentId: string) => void;
  onViewObligation?: (obligationId: string) => void;
  onCorrectPayment?: (paymentId: string) => void;
  hostelId: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  joinedOn?: string;
  documents?: Record<string, any>[];
  allocations?: Record<string, any>[];
  moveOutRequest?: Record<string, any> | null;
  invitations?: Record<string, any>[];
}

const PAGE_SIZE = 8;

/**
 * Replaces the former Financial Activity, Ledger & Accounting Statement, and
 * Recent Activity sections (and the standalone Invitation History card) —
 * one chronological, filterable feed instead of four overlapping ones.
 */
export function UnifiedActivityTimeline({
  events,
  ledgerEntries,
  isLoading,
  onDownloadReceipt,
  onViewObligation,
  onCorrectPayment,
  hostelId,
  tenantId,
  tenantName,
  tenantStatus,
  joinedOn,
  documents = [],
  allocations = [],
  moveOutRequest,
  invitations = [],
}: UnifiedActivityTimelineProps) {
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: systemLogsData, isLoading: systemLogsLoading } = useQuery({
    queryKey: queryKeys.tenants.activity(hostelId, tenantId),
    queryFn: () => activityListService.getList(hostelId, { tenantId, limit: 50 }),
    staleTime: 60_000,
  });
  const systemLogs = (Array.isArray(systemLogsData) ? systemLogsData : (systemLogsData as Record<string, any>)?.items ?? (systemLogsData as Record<string, any>)?.activity ?? []) as Record<string, any>[];

  const grouped = useMemo(() => groupFinancialActivity(events), [events]);

  const generalEvents = useMemo(
    () => buildGeneralEvents({ joinedOn, allocations, documents, moveOutRequest, invitations, tenantStatus, systemLogs, tenantId, tenantName }),
    [joinedOn, allocations, documents, moveOutRequest, invitations, tenantStatus, systemLogs, tenantId, tenantName],
  );

  const balanceByLedgerEntryId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of ledgerEntries) map.set(entry.id, entry.balance_after);
    return map;
  }, [ledgerEntries]);

  const merged = useMemo<UnifiedEntry[]>(() => {
    const financial: UnifiedEntry[] = grouped.map((entry) => ({ kind: 'financial', timestamp: entry.timestamp, financial: entry }));
    const general: UnifiedEntry[] = generalEvents.map((event) => ({ kind: 'general', timestamp: event.timestamp, general: event }));
    return [...financial, ...general].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [grouped, generalEvents]);

  const filtered = useMemo(
    () =>
      merged.filter((item) => {
        if (activeFilter === 'all') return true;
        if (item.kind === 'financial') return matchesFinancialFilter(item.financial.primary, activeFilter);
        if (activeFilter === 'kyc') return item.general.category === 'documents';
        if (activeFilter === 'room_stay') return item.general.category === 'stay';
        if (activeFilter === 'system') return item.general.category === 'system';
        return false;
      }),
    [merged, activeFilter],
  );

  const visible = filtered.slice(0, visibleCount);
  const loading = Boolean(isLoading) || systemLogsLoading;

  return (
    <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h3 className="text-sm font-bold text-foreground">Activity</h3>
      </div>

      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {FILTER_CHIPS.map((chip) => {
          const ChipIcon = chip.icon;
          const isSelected = activeFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                setActiveFilter(chip.id);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                isSelected
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/10'
              }`}
            >
              <ChipIcon className="w-3.5 h-3.5" />
              <span>{chip.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-10">
          <Calendar className="w-7 h-7 text-muted-foreground opacity-50 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No activity recorded yet for this filter.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1 scrollbar-hide">
          {visible.map((item) => {
            if (item.kind === 'financial') {
              const entry = item.financial;
              const isLedger = entry.primary.type === 'LEDGER_CREDIT' || entry.primary.type === 'LEDGER_DEBIT';
              const balanceAfter = isLedger ? balanceByLedgerEntryId.get(entry.primary.references.ledger_entry_id ?? '') ?? null : null;
              return (
                <FinancialActivityCard
                  key={entry.id}
                  entry={entry}
                  balanceAfter={balanceAfter}
                  isExpanded={expandedId === entry.id}
                  onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  onDownloadReceipt={onDownloadReceipt}
                  onViewObligation={onViewObligation}
                  onCorrectPayment={onCorrectPayment}
                />
              );
            }
            const event = item.general;
            const Icon = event.icon;
            return (
              <div key={event.id} className="flex items-start gap-3 p-3.5 rounded-2xl border border-border bg-card">
                <div className={`p-1.5 rounded-lg shrink-0 border ${event.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-bold text-foreground">{event.title}</p>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  {event.subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{event.subtitle}</p>}
                </div>
              </div>
            );
          })}
          {filtered.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="w-full py-2 text-xs font-semibold text-accent hover:underline"
            >
              Load more ↓
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `DocumentsTab.tsx`**

```tsx
// frontend-v2/src/features/tenants/components/profile/DocumentsTab.tsx
import { useState } from 'react';
import { FileCheck2, FileStack } from 'lucide-react';
import { VerificationPanel } from '@features/tenants/components/documents/VerificationPanel';
import { DocumentsHub } from '@features/tenants/components/financial/DocumentsHub';

type DocGroup = 'kyc' | 'contract';

interface RecentPayment {
  id: string;
  amount?: number;
  date?: string;
  method?: string;
  reference_number?: string;
}

interface ChangeRequestSummary {
  id: string;
  change_type?: string;
  status?: string;
  requested_at?: string;
  applied_at?: string;
}

interface DocumentsTabProps {
  hostelId: string;
  tenantId: string;
  profileType?: string;
  photoUrl?: string;
  documents: Record<string, any>[];
  documentVerificationStatus: string;
  onDocumentsUpdated: () => void;
  onRemindDocuments: () => void;
  onResendRules: () => void;
  onDownloadAcceptanceRecord: () => void;
  hasAgreement: boolean;
  recentPayments: RecentPayment[];
  recentChanges: ChangeRequestSummary[];
  onViewAllChanges?: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  VERIFIED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  PENDING: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

/**
 * Merges the former standalone "KYC Verification & Documents" card with the
 * financial DocumentsHub (Agreement/Receipts/Payment Link/Change Request) —
 * both are "documents for this tenant," just different document families.
 */
export function DocumentsTab({
  hostelId,
  tenantId,
  profileType,
  photoUrl,
  documents,
  documentVerificationStatus,
  onDocumentsUpdated,
  onRemindDocuments,
  onResendRules,
  onDownloadAcceptanceRecord,
  hasAgreement,
  recentPayments,
  recentChanges,
  onViewAllChanges,
}: DocumentsTabProps) {
  const [group, setGroup] = useState<DocGroup>('kyc');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setGroup('kyc')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
            group === 'kyc' ? 'bg-accent text-accent-foreground border-accent' : 'bg-card text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          <span>Identity &amp; KYC</span>
          <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase ${STATUS_BADGE[documentVerificationStatus] ?? 'bg-rose-500/10 text-rose-600 border-rose-500/20'}`}>
            {documentVerificationStatus}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setGroup('contract')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
            group === 'contract' ? 'bg-accent text-accent-foreground border-accent' : 'bg-card text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          <FileStack className="w-3.5 h-3.5" />
          <span>Contract &amp; Payments</span>
        </button>
      </div>

      {group === 'kyc' ? (
        <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
          <div className="flex gap-3 flex-wrap justify-between items-center text-xs">
            <div className="flex gap-2">
              <button type="button" onClick={onRemindDocuments} className="text-accent font-semibold hover:underline">
                Remind documents
              </button>
              <span className="text-muted-foreground/30">·</span>
              <button type="button" onClick={onResendRules} className="text-muted-foreground hover:text-foreground hover:underline">
                Resend rules reminder
              </button>
            </div>
            <button type="button" onClick={onDownloadAcceptanceRecord} className="text-muted-foreground hover:text-foreground hover:underline">
              Download rules acceptance JSON
            </button>
          </div>

          <VerificationPanel
            hostelId={hostelId}
            tenantId={tenantId}
            profileType={profileType}
            documents={documents}
            photoUrl={photoUrl}
            onUpdated={onDocumentsUpdated}
          />
        </div>
      ) : (
        <DocumentsHub
          tenantId={tenantId}
          hasAgreement={hasAgreement}
          agreementUrl={null}
          recentPayments={recentPayments}
          recentChanges={recentChanges}
          onViewAllChanges={onViewAllChanges}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the extended `UnifiedActivityTimeline`, new `DocumentsTab`, and new Stay tab into `TenantProfilePage.tsx`; remove the four now-redundant standalone blocks**

Update the `activitySection` const to pass the new props:
```ts
const activitySection = (
  <UnifiedActivityTimeline
    events={financialEvents}
    ledgerEntries={(advance as any)?.entries ?? []}
    isLoading={(financialTimeline as any) === undefined}
    onDownloadReceipt={handleDownloadReceipt}
    onViewObligation={() => setActiveTab('obligations')}
    onCorrectPayment={setCorrectingPaymentId}
    hostelId={hostelId}
    tenantId={tenantId}
    tenantName={name}
    tenantStatus={status}
    joinedOn={String(tenant.joined_on ?? overview.joined_at ?? '')}
    documents={(full?.identification_documents ?? full?.documents ?? [])}
    allocations={allocations}
    moveOutRequest={overview.move_out ?? overview.move_out_request}
    invitations={(tenant?.tenant_invitations ?? overview?.tenant_invitations ?? []) as any[]}
  />
);
```

Replace the `documentsSection` const:
```ts
const documentsSection = (
  <DocumentsHub
    tenantId={tenantId}
    hasAgreement={Boolean(allocations?.length > 0)}
    agreementUrl={null}
    recentPayments={recentPayments as any}
    recentChanges={recentChanges as any}
    onViewAllChanges={() => navigate(`/changes?tenantId=${tenantId}`)}
  />
);
```
with:
```ts
const documentsSection = (
  <DocumentsTab
    hostelId={hostelId}
    tenantId={tenantId}
    profileType={String(tenant?.profile_type ?? 'STUDENT')}
    photoUrl={photoUrl}
    documents={(full?.identification_documents ?? full?.documents ?? []) as Record<string, unknown>[]}
    documentVerificationStatus={String(compliance.document_verification_status ?? 'MISSING').toUpperCase()}
    onDocumentsUpdated={refetch}
    onRemindDocuments={() => runComplianceAction('REMIND_DOCUMENTS', 'Document reminder sent')}
    onResendRules={() => runComplianceAction('RESEND_RULES', 'Rules reminder sent')}
    onDownloadAcceptanceRecord={downloadAcceptanceRecord}
    hasAgreement={Boolean(allocations?.length > 0)}
    recentPayments={recentPayments as any}
    recentChanges={recentChanges as any}
    onViewAllChanges={() => navigate(`/changes?tenantId=${tenantId}`)}
  />
);
```

Add a `staySection` const (place it next to the other `*Section` consts, e.g. right after `documentsSection`):
```ts
const staySection = (
  <div className="space-y-6">
    <AllocationHistoryTimeline
      hostelId={hostelId}
      tenantId={tenantId}
      allocations={allocations}
      currentRoom={currentRoom}
      onChanged={refetch}
    />
    <div className="border-t border-border/60 pt-5">
      <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
        <LogOut className="w-4 h-4 text-rose-500" />
        Move-Out Settlement Workflow
      </h4>
      <ExitWorkflowSection hostelId={hostelId} tenantId={tenantId} status={status} />
    </div>
  </div>
);
```

Update the `TabId` type and the `Tabs` block from Task 3:
```ts
type TabId = 'obligations' | 'activity' | 'documents';
```
to:
```ts
type TabId = 'obligations' | 'activity' | 'documents' | 'stay';
```

```tsx
<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
  <TabsList className="w-full overflow-x-auto scrollbar-hide">
    <TabsTrigger value="obligations">Obligations</TabsTrigger>
    <TabsTrigger value="activity">Activity</TabsTrigger>
    <TabsTrigger value="documents">Documents</TabsTrigger>
  </TabsList>
  <TabsContent value="obligations">{obligationsSection}</TabsContent>
  <TabsContent value="activity">{activitySection}</TabsContent>
  <TabsContent value="documents">{documentsSection}</TabsContent>
</Tabs>
```
to:
```tsx
<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
  <TabsList className="w-full overflow-x-auto scrollbar-hide">
    <TabsTrigger value="obligations">Obligations</TabsTrigger>
    <TabsTrigger value="activity">Activity</TabsTrigger>
    <TabsTrigger value="documents">Documents</TabsTrigger>
    <TabsTrigger value="stay">Stay</TabsTrigger>
  </TabsList>
  <TabsContent value="obligations">{obligationsSection}</TabsContent>
  <TabsContent value="activity">{activitySection}</TabsContent>
  <TabsContent value="documents">{documentsSection}</TabsContent>
  <TabsContent value="stay">{staySection}</TabsContent>
</Tabs>
```

Now delete the four now-redundant standalone blocks entirely:

1. The "Collapsible Identity & KYC Documents Card" block (from `{/* Collapsible Identity & KYC Documents Card */}` through its closing `</div>`, including the `isKycExpanded` toggle button, the `VerificationPanel` render, and the reminder/rules-acceptance action row) — this content now lives in `DocumentsTab`'s "Identity & KYC" group.
2. The "Collapsible Stay History & Move-Out settings" block (from `{/* Collapsible Stay History & Move-Out settings */}` through its closing `</div>`, including the `isStayExpanded` toggle button, `AllocationHistoryTimeline`, and `ExitWorkflowSection`) — this content now lives in the `staySection` const / Stay tab.
3. The "Non-financial general activity feed" block (`{/* Non-financial general activity feed (KYC/room/system/comms) — kept separate from Financial Activity */}` through its closing `</div>`, including the `<ActivityTimeline .../>` render) — this content is now folded into `UnifiedActivityTimeline`.
4. The "Invitation history card" block (`{/* Invitation history card (only shown if invitations exist) */}` through its closing `)}`) — this content is now folded into `UnifiedActivityTimeline` as invitation-derived general events.

Remove the now-unused state: `isKycExpanded`/`setIsKycExpanded`, `isStayExpanded`/`setIsStayExpanded` — **wait**: `setIsStayExpanded` is also called from `onCheckout` in `PrimaryActionsBar`'s wiring (Task 2). Update that wiring now that Stay is a tab:

Replace (from Task 2):
```ts
onCheckout={() => {
  setIsStayExpanded(true);
  setTimeout(() => {
    document.getElementById('stay-details-section')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}}
```
with:
```ts
onCheckout={() => setActiveTab('stay')}
```
Now `isStayExpanded`/`setIsStayExpanded` has no remaining callers — remove its `useState` declaration. Same for `isKycExpanded`/`setIsKycExpanded` (no remaining callers after deleting block 1 above) — remove its `useState` declaration too.

Update imports: remove
```ts
import { ActivityTimeline } from '@features/tenants/components/profile/ActivityTimeline';
```
and remove `ChevronDown`, `ChevronUp`, `BedDouble`, `History`, and (per the note in Task 2) `FileCheck2` from the top `lucide-react` import **only if** `grep -n "ChevronDown\|ChevronUp\|BedDouble\|History\|FileCheck2" TenantProfilePage.tsx` shows no remaining uses after the deletions above (they were only used by the two collapsible-card toggle buttons, the two card headers, and — for `FileCheck2` — the KYC card header, all being deleted in this task) — verify with the grep before removing each one, don't remove blind.

- [ ] **Step 4: Delete `ActivityTimeline.tsx`**

```bash
git rm frontend-v2/src/features/tenants/components/profile/ActivityTimeline.tsx
```

- [ ] **Step 5: Verify**

Run from `frontend-v2/`: `npm run build` — expected pass.

Then in the dev server, open a tenant's profile with some history (payments, an uploaded KYC document, a room allocation, at least one invitation):
- Confirm 4 tabs now: Obligations / Activity / Documents / Stay.
- Activity tab: confirm payment/ledger cards AND simpler dot-style rows (room allocation, document upload, invitation, joined-hostel) appear interleaved in one chronological list. Click each new filter chip (KYC, Room & Stay, System) and confirm it isolates the right entries.
- Documents tab: confirm the "Identity & KYC" / "Contract & Payments" toggle both render their respective content (document checklist with reminder actions; Agreement/Receipts/Payment Link/Change Request sub-tabs).
- Stay tab: confirm room allocation history and the move-out workflow both render exactly as they did in the old collapsible card.
- Click "Check-out / Exit" in the action bar's "More" menu — confirm it switches straight to the Stay tab (not the old scroll+expand behavior).
- Confirm the old standalone "KYC Verification & Documents", "Stay Details & Checkout Workflow", "Recent Activity", and "Invitation History Logs" cards are completely gone from below the tabs.

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx frontend-v2/src/features/tenants/components/profile/DocumentsTab.tsx frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx
git commit -m "feat(tenant-profile): fold KYC/Stay/Recent-Activity/Invitation-History into Documents/Stay tabs and UnifiedActivityTimeline"
```

---

### Task 5: Documentation + final verification

**Files:**
- Modify: `docs/obsidian/Frontend.md`
- Modify: `docs/obsidian/Features.md`
- Modify: `docs/obsidian/Changelog.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Fix stale passages in `docs/obsidian/Features.md`**

Search for and update every passage that references a file/wiring this plan deleted or moved (found via `grep -n "FinancialActivity\.tsx\|LedgerStatement\|ActivityTimeline\|OwnerInsights\|TenantHealthCard\|FinancialWorkspaceNav\|Financial Activity feed" docs/obsidian/Features.md` — re-run this grep at implementation time since exact line numbers may have shifted since this plan was written):

- The "Correct Payment (Reverse / Transfer)" entry's Key Files line currently says `FinancialActivity.tsx (threads the prop)` — update to `UnifiedActivityTimeline.tsx (threads the prop)`.
- The same entry's Notes currently say "Wired directly into the Tenant Details page's Financial Activity feed" and "the 'Correct Payment' button is a conditional render... alongside the existing 'View Receipt' button" — update "Financial Activity feed" to "Activity tab's unified timeline" (the button/conditional-render mechanics inside `FinancialActivityCard` are unchanged, only the container section's name changes).
- The "Change Rent" entry's Key Files line currently says `"Change Rent" button rendered next to PrimaryActionsBar when tenant status is ACTIVE` — update to reflect that Change Rent is now one of `PrimaryActionsBar`'s own overflow-menu actions, not a separate adjacent button.
- Add a new row to the Owner-facing features table (or a new subsection, matching this page's existing format) documenting the consolidation itself: real tabs (Obligations/Activity/Documents/Stay) replacing the scroll-nav, `RiskComplianceCard` replacing Tenant Health + Owner Insights, `UnifiedActivityTimeline` replacing Financial Activity + Ledger Statement + Recent Activity + Invitation History, `DocumentsTab` replacing the separate KYC card + DocumentsHub section, and the consolidated `PrimaryActionsBar` (with overflow menu) replacing the 3-group, 8-button action layout. Cross-reference `[[Frontend]]`.

- [ ] **Step 2: Update `docs/obsidian/Frontend.md`**

Find wherever this page's structure/section list is described (if `TenantProfilePage` isn't described in detail there yet, add a short paragraph) and record the new structure: always-visible zone (header, Communication Center, consolidated action bar, Risk & Compliance + Private Notes, stat strip + health banner) followed by 4 real tabs (Obligations, Activity, Documents, Stay). Note which components were deleted (`TenantHealthCard`, `OwnerInsights`, `FinancialActivity`, `LedgerStatement`, `ActivityTimeline`, `FinancialWorkspaceNav`) and which were added (`RiskComplianceCard`, `UnifiedActivityTimeline`, `DocumentsTab`). Cross-reference `[[Features]]`.

- [ ] **Step 3: Add a `docs/obsidian/Changelog.md` entry**

Under `## [Unreleased]` → `### Changed` (this is a refactor of existing features, not new functionality), add a dated bullet (use the actual date at implementation time) summarizing: real tabs replacing the false scroll-nav; three overlapping activity/ledger feeds merged into one filterable `UnifiedActivityTimeline`; two overlapping risk cards merged into `RiskComplianceCard`; eight scattered action buttons consolidated into one `PrimaryActionsBar` with an overflow menu; KYC and Documents merged into one `DocumentsTab`. Note explicitly that no backend or business-logic changes were made. Cross-reference `[[Features]]`, `[[Frontend]]`.

- [ ] **Step 4: Final full verification**

Run from `frontend-v2/`: `npm run build` — expected pass (architecture check, vite build, branding check).

Then, with the dev server running, do a full manual walkthrough on at least two different tenants (one with a rich history — payments, KYC docs, room changes, an invitation; one newer/simpler tenant with little history) and confirm:
- The always-visible zone shows exactly: header, Communication Center + action bar row, Risk & Compliance + Private Notes row, stat strip + health banner — no leftover "Core Action Dashboard", no 3-card insights row.
- Exactly 4 tabs exist and each renders correctly for both tenants, including the simpler tenant (empty states should read sensibly, not crash or show "undefined").
- The action bar's primary button, 3 secondary buttons, and "More" menu (with all 4 overflow actions) all still trigger their correct existing modals/flows.
- No console errors appear in the browser dev tools while navigating the page and switching tabs.
- `grep -rn "FinancialWorkspaceNav\|OwnerInsights\|TenantHealthCard\|LedgerStatement\|ActivityTimeline'" frontend-v2/src --include="*.tsx" --include="*.ts"` (excluding `UnifiedActivityTimeline.tsx` itself, which legitimately contains the substring "ActivityTimeline" in its own name) returns no remaining references — confirms no orphan imports were left behind.

- [ ] **Step 5: Commit**

```bash
git add docs/obsidian/Frontend.md docs/obsidian/Features.md docs/obsidian/Changelog.md
git commit -m "docs: document Tenant Profile UI/UX consolidation"
```

---

## Self-Review

**1. Spec coverage:** All four consolidation decisions from the approved design are covered — real tabs (Task 3/4), unified activity timeline (Task 3/4), merged risk card (Task 1), consolidated action bar (Task 2) — plus the Documents+KYC merge and Stay tab (Task 4) and required docs update (Task 5). The declined item (Agreement-status wording fix) is correctly absent from every task.

**2. Placeholder scan:** No TBD/TODO. Every step has complete, runnable code. The two places a `grep` is deliberately specified instead of a hardcoded line number (Task 4 Step 3's icon-import cleanup, Task 5 Step 1's stale-passage search) are flagged as "verify before acting," not vague guidance — consistent with how the codebase's own conventions (seen in the prior payment-correction plan) handle "check against real code before finalizing."

**3. Type consistency:** `TabId` is introduced in Task 3 as `'obligations' | 'activity' | 'documents'` and explicitly extended in Task 4 to add `'stay'` — both the type declaration and every `Tabs`/`TabsTrigger`/`TabsContent` usage are updated together in the same task. `PrimaryActionsBarProps`' new fields (`onRequestChange`, `requestChangeLabel`, `onChangeRent`, `canChangeRent`, `onCheckout`) are defined once in Task 2 and never renamed later. `UnifiedActivityTimelineProps` is defined in Task 3 and explicitly extended (not redefined incompatibly) in Task 4.
