# Payment Correction Completion & Change Rent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solve two owner-facing gaps: (A) let an owner fix a payment recorded against the wrong tenant or for the wrong amount, discovered after the fact, using the already-built Reverse/Transfer correction handlers; (B) let an owner change a tenant's rent immediately (no tenant approval), from a month they pick onward, with all not-yet-due, zero-payment installments automatically repriced.

**Architecture:** Part A is almost entirely frontend — `PAYMENT_REVERSAL` and `PAYMENT_TRANSFER` Correction Handlers and the generic `recoveryService` API wrapper already exist and need no changes; the work is extending `CorrectPaymentModal` with a correction-type selector and a tenant picker (reusing the existing `paymentService.quickCollectSearch` tenant-search), plus a guided post-reversal re-record prompt. Part B is a new, narrowly-scoped backend service function (`applyRentChangeInTx`) that reuses the exact "patch amount only when the obligation has zero payments" safety rule already proven in `agreement-rent-schedule-service.ts`, but adds month-scoping that service lacks — implemented as a standalone function rather than a modification to that shared, renewal-critical service. A new API route (identity-confirmed, like Waive/Cancel Obligation) and a new `OwnerAction` (category `WORKFLOW`) expose it, followed by a `ChangeRentModal` on the Tenant Details page.

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres (`backend-next/`); Vite + React 19 + TanStack Query (`frontend-v2/`); Vitest against real Postgres (`fileParallelism: false`).

## Global Constraints

- `payments`/`rent_obligations` immutability rules from prior work still apply: Part A introduces no new payment-mutation logic (it only orchestrates the existing Reverse/Transfer handlers); Part B's obligation repricing follows the established, already-shipped convention that a `rent_obligations` row with **zero recorded payments** may have `amount`/`total_amount` patched in place (this is not a new pattern — `agreement-rent-schedule-service.ts` already does exactly this) — a row with any payment must never be touched.
- Every new/modified backend route resolves `hostelId` via `resolveOwnerScope`/`requireHostelBelongsToOwner`, never optional, matching the invariant enforced by `architectural-invariants-check.ts`.
- The identity-confirmation guard (`verifyIdentityConfirmation` + `consumeIdentityTokenInTx` from `backend-next/src/services/payments/identity-confirmation-guard.ts`) gates the Change Rent mutation, exactly as it already gates Waive/Cancel Obligation — same token flow, same error codes.
- All new frontend code imports `api` from `@lib/api-client` — never raw `fetch()`/`axios`.
- New backend tests go in `backend-next/tests/integration/*.test.ts`; frontend has no test suite — verify by code read-back + `npm run build` (includes `check:architecture` + branding check).
- Per `CLAUDE.md`'s Documentation Rules, any task that adds an API route, registers a new `OwnerAction`, or introduces a business rule (Change Rent's "immediate, owner-only, month-scoped repricing" policy) updates the relevant `docs/obsidian/` page in the same commit — `APIs.md` for the new route, `Business-Rules.md` for the repricing rule, `Features.md`/`Changelog.md` for both features.

---

## Part A: Complete the Correct Payment UX

### File Structure (Part A)

```
frontend-v2/
  src/app/components/modals/CorrectPaymentModal.tsx   [modify — add correction-type selector + tenant picker]
  src/features/tenants/components/financial/FinancialActivityCard.tsx  [no change — already wired]
```

No backend changes in Part A — `PAYMENT_TRANSFER`'s handler, policy, and API route all already exist and are already tested (`backend-next/src/services/payments/corrections/payment-transfer-handler.ts`, `backend-next/tests/integration/payment-transfer-handler.test.ts`). `recoveryService.createCase()` already accepts an arbitrary `caseType`/`input`, so Transfer needs no new API wrapper method.

---

### Task 1: Add a correction-type selector (Reverse / Wrong Tenant) to `CorrectPaymentModal`

**Files:**
- Modify: `frontend-v2/src/app/components/modals/CorrectPaymentModal.tsx`

**Interfaces:**
- Consumes: `recoveryService.createCase({hostelId, caseType, reason, input})` (existing, unchanged — `caseType: 'PAYMENT_TRANSFER'` needs `input: { paymentId, toTenantId }` instead of `PAYMENT_REVERSAL`'s `input: { paymentId }`).
- Produces: the modal now supports two `correctionType` values, `'REVERSE' | 'TRANSFER'`, selected via a two-button toggle at the top of the form, shown before the reason field.

- [ ] **Step 1: Add the correction-type toggle state and UI**

In `CorrectPaymentModal.tsx`, add a new state variable right after the existing `reason` state:
```ts
const [correctionType, setCorrectionType] = useState<'REVERSE' | 'TRANSFER'>('REVERSE');
const [toTenantQuery, setToTenantQuery] = useState('');
const [toTenantId, setToTenantId] = useState<string | null>(null);
const [toTenantName, setToTenantName] = useState<string | null>(null);
```

Add the toggle UI immediately after the header block (after the closing `</div>` of the icon+title block, before the `{succeeded ? (` conditional):
```tsx
{!succeeded && !kase && (
  <div className="flex gap-2 mb-4">
    <button
      type="button"
      onClick={() => { setCorrectionType('REVERSE'); setToTenantId(null); setToTenantName(null); }}
      className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-colors ${
        correctionType === 'REVERSE' ? 'bg-rose-600 text-white' : 'bg-secondary text-secondary-foreground'
      }`}
    >
      Wrong / Reverse
    </button>
    <button
      type="button"
      onClick={() => setCorrectionType('TRANSFER')}
      className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-colors ${
        correctionType === 'TRANSFER' ? 'bg-rose-600 text-white' : 'bg-secondary text-secondary-foreground'
      }`}
    >
      Wrong Tenant / Transfer
    </button>
  </div>
)}
```

- [ ] **Step 2: Add the tenant-search picker, shown only when `correctionType === 'TRANSFER'`**

Add these imports at the top of the file:
```ts
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paymentService } from '@features/payments/api';
```

Add a debounced search query right after the new state declarations from Step 1:
```ts
const [debouncedToTenantQuery, setDebouncedToTenantQuery] = useState('');
useEffect(() => {
  const handle = setTimeout(() => setDebouncedToTenantQuery(toTenantQuery), 250);
  return () => clearTimeout(handle);
}, [toTenantQuery]);

const { data: toTenantResults, isLoading: toTenantSearchLoading } = useQuery({
  queryKey: ['payments', 'quick-collect', 'search', debouncedToTenantQuery],
  queryFn: () => paymentService.quickCollectSearch(debouncedToTenantQuery),
  enabled: correctionType === 'TRANSFER' && debouncedToTenantQuery.length >= 2 && !toTenantId,
  staleTime: 5000,
});
```

Insert the picker UI right after the correction-type toggle from Step 1, still gated on `!succeeded && !kase`:
```tsx
{correctionType === 'TRANSFER' && (
  <div className="space-y-1.5 mb-4">
    <label className="text-xs font-semibold text-foreground">
      Correct tenant <span className="text-rose-500">*</span>
    </label>
    {toTenantId ? (
      <div className="flex items-center justify-between rounded-xl border border-input bg-muted/40 px-3 py-2 text-sm">
        <span className="font-semibold text-foreground">{toTenantName}</span>
        <button
          type="button"
          onClick={() => { setToTenantId(null); setToTenantName(null); setToTenantQuery(''); }}
          className="text-[11px] font-semibold text-accent hover:underline"
        >
          Change
        </button>
      </div>
    ) : (
      <>
        <input
          type="text"
          value={toTenantQuery}
          onChange={(e) => setToTenantQuery(e.target.value)}
          placeholder="Search tenant by name or phone"
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {toTenantSearchLoading && <p className="text-[11px] text-muted-foreground px-1">Searching…</p>}
        {toTenantResults && toTenantResults.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {toTenantResults.map((t: any) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setToTenantId(t.id); setToTenantName(t.name); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span className="font-semibold text-foreground">{t.name}</span>
                <span className="text-muted-foreground ml-2">{t.phone}</span>
              </button>
            ))}
          </div>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 3: Wire `correctionType`/`toTenantId` into `handlePreview` and update validation**

Replace the existing `handlePreview` body's validation and `createCase` call:
```ts
const handlePreview = async (e: React.FormEvent) => {
  e.preventDefault();
  setFieldError(null);
  setApiError(null);

  if (!reason.trim()) {
    setFieldError('Enter a reason for this correction.');
    return;
  }
  if (correctionType === 'TRANSFER' && !toTenantId) {
    setFieldError('Search for and select the correct tenant.');
    return;
  }

  setIsPreviewing(true);
  try {
    const created = await recoveryService.createCase({
      hostelId,
      caseType: correctionType === 'TRANSFER' ? 'PAYMENT_TRANSFER' : 'PAYMENT_REVERSAL',
      reason: reason.trim(),
      input: correctionType === 'TRANSFER' ? { paymentId, toTenantId } : { paymentId },
    });
    setKase(created);
  } catch (err) {
    setApiError(err);
  } finally {
    setIsPreviewing(false);
  }
};
```

- [ ] **Step 4: Update the header copy and confirm-button label to reflect the selected correction type**

Replace the static header description paragraph:
```tsx
<p className="text-xs text-muted-foreground">
  {correctionType === 'TRANSFER'
    ? "Moves this payment to the correct tenant's obligations"
    : 'Reverses this payment and re-opens the obligation it settled'}
</p>
```

Replace the "Confirm Reversal" button label:
```tsx
<span>{correctionType === 'TRANSFER' ? 'Confirm Transfer' : 'Confirm Reversal'}</span>
```

And the success-state copy:
```tsx
<p className="text-sm font-bold text-foreground">
  {correctionType === 'TRANSFER' ? 'Payment transferred' : 'Payment reversed'}
</p>
```

- [ ] **Step 5: Update `handleEditReason` to also reset the tenant picker**

```ts
const handleEditReason = () => {
  setKase(null);
  setApiError(null);
  setSucceeded(false);
};
```
(unchanged — resetting `kase` to `null` already re-shows the toggle/picker per Step 1/2's `!kase` gates; no further change needed here.)

- [ ] **Step 6: Verify by reading the code back and running the build**

Read the full modified file once to confirm: the toggle only shows pre-preview (`!kase`), the tenant picker only shows for `TRANSFER`, `handlePreview` sends the right `caseType`/`input` for each mode, and `toTenantId` is required before submit in transfer mode.

Run from `frontend-v2/`:
```bash
npm run build
```
Expected: passes (`check:architecture`, `vite build`, branding check all green).

- [ ] **Step 7: Update docs**

In `docs/obsidian/Features.md`, find the "Correct Payment (Reverse only)" entry added in the prior session's work and update it to describe both correction types, renaming the section to "Correct Payment (Reverse / Transfer)". Add a bullet to `docs/obsidian/Changelog.md` under `## [Unreleased]` → `### Added`.

- [ ] **Step 8: Commit**

```bash
git add frontend-v2/src/app/components/modals/CorrectPaymentModal.tsx docs/obsidian/Features.md docs/obsidian/Changelog.md
git commit -m "feat(payments): add Transfer (wrong tenant) support to Correct Payment modal"
```

---

### Task 2: Guided "wrong amount" flow — Reverse then prompt to re-record

**Files:**
- Modify: `frontend-v2/src/app/components/modals/CorrectPaymentModal.tsx`
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Consumes: existing `RecordPaymentModal` (`frontend-v2/src/app/components/modals/RecordPaymentModal.tsx`), which already accepts a `context: { tenantId }` prop to pre-scope the payment to a tenant (used elsewhere in this file already — check its exact prop name by reading the component's props interface before wiring, since the plan text here describes intent, not a guaranteed exact prop name).
- Produces: `CorrectPaymentModal` gains an optional `onSuccessReverse?: (tenantId: string) => void` callback, invoked only when a `REVERSE` (not `TRANSFER`) correction completes successfully. `TenantProfilePage.tsx` uses this to open `RecordPaymentModal` immediately after a successful reversal.

- [ ] **Step 1: Read `RecordPaymentModal`'s exact prop interface**

Run: `grep -n "interface.*Props\|context:" frontend-v2/src/app/components/modals/RecordPaymentModal.tsx | head -20`

Confirm the exact shape of its `context` prop (it's referenced as `context.tenantId` in the file per Part A's research, e.g. `context: { tenantId?: string; obligationId?: string }`). Use the real shape found here in Step 3 below — do not guess.

- [ ] **Step 2: Add the `onSuccessReverse` callback prop to `CorrectPaymentModal`**

Update the props interface:
```ts
interface CorrectPaymentModalProps {
  paymentId: string;
  hostelId: string;
  tenantId: string;
  onClose: () => void;
  onSuccessReverse?: (tenantId: string) => void;
}
```

Update the component signature:
```ts
export function CorrectPaymentModal({ paymentId, hostelId, tenantId, onClose, onSuccessReverse }: CorrectPaymentModalProps) {
```

In `handleConfirm`, after `setSucceeded(true)` and before the `setTimeout(() => onClose(), 1200)` line, add:
```ts
if (correctionType === 'REVERSE') {
  onSuccessReverse?.(tenantId);
}
```
(Only for `REVERSE` — a Transfer's money has already moved to the correct tenant, there's nothing to re-record.)

- [ ] **Step 3: Wire `TenantProfilePage.tsx` to open `RecordPaymentModal` on `onSuccessReverse`**

Read the existing `<CorrectPaymentModal ... />` render call and the existing `RecordPaymentModal` render/state pattern already in this file (there should already be a `showRecordPayment`/similar boolean state controlling an existing "Receive Payment" flow — reuse that same state variable rather than adding a second one, so there's only one `RecordPaymentModal` mount point in this file. If the existing state is a plain boolean without tenant-scoping context, check whether `RecordPaymentModal` already defaults to the page's current tenant when no explicit `context.tenantId` override is passed — if so, simply triggering the existing "open receive payment" state is sufficient and no new prop threading is needed.)

Wire the correction modal's new callback:
```tsx
<CorrectPaymentModal
  paymentId={correctingPaymentId}
  hostelId={hostelId}
  tenantId={tenantId}
  onClose={() => setCorrectingPaymentId(null)}
  onSuccessReverse={() => {
    // Give the reversal's own success state (1.2s) time to display before
    // stacking a second modal — small deliberate delay, not a race condition
    // fix, since onClose() already runs on its own timer independently.
    setTimeout(() => setShowRecordPayment(true), 1300);
  }}
/>
```
Replace `setShowRecordPayment` with whatever the actual existing state setter for opening the Receive Payment flow is named in this file (found in Step 1) — do not introduce a duplicate.

- [ ] **Step 4: Verify by reading the code back and running the build**

Confirm: `onSuccessReverse` only fires for `REVERSE`, not `TRANSFER`; the existing Receive Payment modal opens scoped to the same tenant whose payment was just reversed; no duplicate modal-open state was introduced.

Run from `frontend-v2/`: `npm run build` — expected pass.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/app/components/modals/CorrectPaymentModal.tsx frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx
git commit -m "feat(payments): prompt to re-record payment immediately after a wrong-amount reversal"
```

---

## Part B: Change Rent

### File Structure (Part B)

```
backend-next/
  src/services/payments/rent-change-service.ts                    [create]
  app/api/tenants/[id]/change-rent/route.ts                        [create]
  src/services/owner-actions/definitions/agreement-actions.ts      [create]
  src/services/owner-actions/bootstrap.ts                          [modify — one import line]
  tests/factories/tenant-factory.ts                                [modify — add createTestAgreement]
  tests/integration/rent-change-service.test.ts                    [create]
  tests/integration/change-rent-api.test.ts                        [create]
  tests/integration/owner-actions.test.ts                          [extend]

frontend-v2/
  src/features/tenants/api/index.js (or .ts, check actual extension) [modify — add changeRent wrapper]
  src/app/components/modals/ChangeRentModal.tsx                     [create]
  src/features/tenants/components/profile/TenantProfilePage.tsx     [modify — wire entry point]

docs/obsidian/
  APIs.md, Business-Rules.md, Features.md, Changelog.md             [modify]
```

---

### Task 3: `createTestAgreement` factory + `applyRentChangeInTx` service

**Files:**
- Modify: `backend-next/tests/factories/tenant-factory.ts`
- Create: `backend-next/src/services/payments/rent-change-service.ts`
- Test: `backend-next/tests/integration/rent-change-service.test.ts`

**Interfaces:**
- Produces: `createTestAgreement(tenantId: string, hostelId: string, overrides?: any)` test factory; `applyRentChangeInTx(tx, params): Promise<RentChangeResult>` where:
```ts
interface ApplyRentChangeParams {
  agreementId: string;
  hostelId: string;
  newRentAmount: number;
  effectiveFromMonth: Date; // must be the 1st of a UTC month
  actorId: string;
  reason: string;
}
interface RentChangeResult {
  agreementId: string;
  tenantId: string;
  oldRentAmount: number;
  newRentAmount: number;
  effectiveFromMonth: Date;
  obligationsUpdated: number;
  updatedObligationIds: string[];
}
```

- [ ] **Step 1: Add the `createTestAgreement` factory**

Read `backend-next/tests/factories/tenant-factory.ts`'s existing `createTestTenant`/`allocateTestRoom` functions first to match their exact style (they already exist per prior session work — this factory file already has `createTestTenant`, `allocateTestRoom`). Append:
```ts
export async function createTestAgreement(tenantId: string, hostelId: string, overrides: any = {}) {
  return await prisma.agreement.create({
    data: {
      tenant_id: tenantId,
      hostel_id: hostelId,
      status: 'SIGNED',
      contract_rent: 8000,
      agreement_duration_months: 12,
      agreement_start_date: new Date(Date.UTC(2026, 0, 1)),
      ...overrides,
    },
  });
}
```

**Note for the implementer:** run `grep -n "model Agreement " -A 60 backend-next/prisma/schema.prisma` first and confirm every field referenced above (`tenant_id`, `hostel_id`, `status`, `contract_rent`, `agreement_duration_months`, `agreement_start_date`) is spelled exactly as in the real schema and that none of the omitted fields are actually required (`NOT NULL` with no default) — if any other field is required, add a sensible default to the factory's base `data` object before the `...overrides` spread.

- [ ] **Step 2: Write the failing test**

```ts
// backend-next/tests/integration/rent-change-service.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, createTestAgreement } from '../factories/tenant-factory';
import { createTestPayment } from '../factories/payment-factory';
import { applyRentChangeInTx } from '@/src/services/payments/rent-change-service';

async function createFutureRentObligation(tx: any, tenantId: string, hostelId: string, agreementId: string, rentMonth: Date, amount: number, overrides: any = {}) {
  return tx.rent_obligations.create({
    data: {
      tenant_id: tenantId,
      hostel_id: hostelId,
      agreement_id: agreementId,
      obligation_type: 'RENT',
      amount,
      total_amount: amount,
      rent_month: rentMonth,
      due_date: new Date(rentMonth.getTime() + 4 * 24 * 60 * 60 * 1000),
      status: 'UPCOMING',
      lifecycle_status: 'ACTIVE',
      settlement_status: 'UNPAID',
      ...overrides,
    },
  });
}

describe('applyRentChangeInTx', () => {
  it('reprices future zero-payment obligations from the chosen month onward, leaves earlier months untouched', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const agreement = await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });

    const jan = new Date(Date.UTC(2027, 0, 1));
    const feb = new Date(Date.UTC(2027, 1, 1));
    const mar = new Date(Date.UTC(2027, 2, 1));

    const janObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, jan, 8000));
    const febObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, feb, 8000));
    const marObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, mar, 8000));

    const result = await prisma.$transaction((tx) =>
      applyRentChangeInTx(tx, {
        agreementId: agreement.id,
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: feb,
        actorId: owner.id,
        reason: 'annual increment',
      })
    );

    expect(result.obligationsUpdated).toBe(2);
    expect(result.updatedObligationIds.sort()).toEqual([febObligation.id, marObligation.id].sort());
    expect(result.oldRentAmount).toBe(8000);
    expect(result.newRentAmount).toBe(9000);

    const untouchedJan = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: janObligation.id } });
    expect(Number(untouchedJan.amount)).toBe(8000);

    const repricedFeb = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: febObligation.id } });
    expect(Number(repricedFeb.amount)).toBe(9000);
    expect(Number(repricedFeb.total_amount)).toBe(9000);

    const repricedMar = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: marObligation.id } });
    expect(Number(repricedMar.amount)).toBe(9000);

    const updatedAgreement = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } });
    expect(Number(updatedAgreement.contract_rent)).toBe(9000);
  });

  it('never touches an obligation that already has a payment, even if its rent_month is in scope', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const agreement = await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });

    const feb = new Date(Date.UTC(2027, 1, 1));
    const paidFebObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, feb, 8000));
    await createTestPayment(paidFebObligation.id, 8000);

    const result = await prisma.$transaction((tx) =>
      applyRentChangeInTx(tx, {
        agreementId: agreement.id,
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: feb,
        actorId: owner.id,
        reason: 'increment',
      })
    );

    expect(result.obligationsUpdated).toBe(0);
    const untouched = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: paidFebObligation.id } });
    expect(Number(untouched.amount)).toBe(8000);
  });

  it('rejects a hostel mismatch', async () => {
    const owner = await createTestOwner();
    const hostelA = await createTestHostel(owner.id);
    const hostelB = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostelA.id);
    const agreement = await createTestAgreement(tenant.id, hostelA.id);

    await expect(
      prisma.$transaction((tx) =>
        applyRentChangeInTx(tx, {
          agreementId: agreement.id,
          hostelId: hostelB.id,
          newRentAmount: 9000,
          effectiveFromMonth: new Date(Date.UTC(2027, 1, 1)),
          actorId: owner.id,
          reason: 'test',
        })
      )
    ).rejects.toThrow(/hostel/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/integration/rent-change-service.test.ts -v` (from `backend-next/`)
Expected: FAIL — module `@/src/services/payments/rent-change-service` not found.

- [ ] **Step 4: Implement `applyRentChangeInTx`**

```ts
// backend-next/src/services/payments/rent-change-service.ts

export interface ApplyRentChangeParams {
  agreementId: string;
  hostelId: string;
  newRentAmount: number;
  effectiveFromMonth: Date;
  actorId: string;
  reason: string;
}

export interface RentChangeResult {
  agreementId: string;
  tenantId: string;
  oldRentAmount: number;
  newRentAmount: number;
  effectiveFromMonth: Date;
  obligationsUpdated: number;
  updatedObligationIds: string[];
}

function money(value: unknown): number {
  const n = Number(value || 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/**
 * Changes a tenant's rent effective from a chosen month onward. Reuses the
 * same safety rule already established in agreement-rent-schedule-service.ts
 * (a rent_obligations row may be repriced in place ONLY when it has zero
 * recorded payments) but adds month-scoping that service lacks — implemented
 * as a standalone function rather than a modification to that shared,
 * renewal-critical service.
 */
export async function applyRentChangeInTx(
  tx: any,
  params: ApplyRentChangeParams
): Promise<RentChangeResult> {
  const { agreementId, hostelId, newRentAmount, effectiveFromMonth, reason } = params;

  if (!(newRentAmount > 0)) {
    throw new Error("VALIDATION_ERROR: newRentAmount must be greater than 0");
  }
  if (!reason || !reason.trim()) {
    throw new Error("VALIDATION_ERROR: reason is required");
  }

  await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${agreementId}::uuid FOR UPDATE`;

  const agreement = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });

  if (agreement.hostel_id !== hostelId) {
    throw new Error(`Agreement ${agreementId} does not belong to hostel ${hostelId}`);
  }

  const oldRentAmount = money(agreement.contract_rent);

  const candidates = await tx.rent_obligations.findMany({
    where: {
      agreement_id: agreementId,
      obligation_type: "RENT",
      is_superseded: false,
      lifecycle_status: "ACTIVE",
      settlement_status: "UNPAID",
      rent_month: { gte: effectiveFromMonth },
    },
    include: { payments: { select: { id: true } } },
  });

  const safeToReprice = candidates.filter((ob: any) => !ob.payments || ob.payments.length === 0);

  await tx.agreement.update({
    where: { id: agreementId },
    data: { contract_rent: newRentAmount },
  });

  const updatedObligationIds: string[] = [];
  for (const obligation of safeToReprice) {
    await tx.rent_obligations.update({
      where: { id: obligation.id },
      data: {
        amount: newRentAmount,
        total_amount: newRentAmount,
        updated_at: new Date(),
      },
    });
    updatedObligationIds.push(obligation.id);
  }

  return {
    agreementId,
    tenantId: agreement.tenant_id,
    oldRentAmount,
    newRentAmount: money(newRentAmount),
    effectiveFromMonth,
    obligationsUpdated: updatedObligationIds.length,
    updatedObligationIds,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/rent-change-service.test.ts -v`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add backend-next/tests/factories/tenant-factory.ts backend-next/src/services/payments/rent-change-service.ts backend-next/tests/integration/rent-change-service.test.ts
git commit -m "feat(payments): add applyRentChangeInTx — month-scoped, zero-payment-guarded rent repricing"
```

---

### Task 4: `POST /api/tenants/:id/change-rent` route (identity-confirmed)

**Files:**
- Create: `backend-next/app/api/tenants/[id]/change-rent/route.ts`
- Test: `backend-next/tests/integration/change-rent-api.test.ts`

**Interfaces:**
- Consumes: `applyRentChangeInTx` (Task 3), `verifyIdentityConfirmation`/`consumeIdentityTokenInTx` (existing, `src/services/payments/identity-confirmation-guard.ts`), `getSession`/`ApiResponse`/`ApiError`/`resolveOwnerScope`/`requireHostelBelongsToOwner` (existing, verified in prior session's Task 13).
- Produces: `POST /api/tenants/:id/change-rent` body `{ hostelId, newRentAmount, effectiveFromMonth, reason, identityToken }` → `{ success: true, data: RentChangeResult }`; 401/400/403/404/422 per the established pattern from `app/api/recovery/cases/*`.

- [ ] **Step 1: Write the failing test**

```ts
// backend-next/tests/integration/change-rent-api.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { POST } from '@/app/api/tenants/[id]/change-rent/route';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, createTestAgreement } from '../factories/tenant-factory';
import { prisma } from '@/lib/db';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSession: vi.fn() };
});

// Identity confirmation is a real token stored in identity_tokens — construct
// one directly rather than mocking, mirroring how obligation-cancel tests in
// this repo already do it. Check tests/integration/ for an existing example
// of creating a valid identity_tokens row before writing this — grep
// `identity_tokens.create` across tests/ first and match that exact pattern
// rather than inventing a new one.

describe('POST /api/tenants/[id]/change-rent', () => {
  it('changes rent and reprices future obligations for an authenticated owner', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const agreement = await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });
    const feb = new Date(Date.UTC(2027, 1, 1));
    await prisma.rent_obligations.create({
      data: {
        tenant_id: tenant.id, hostel_id: hostel.id, agreement_id: agreement.id,
        obligation_type: 'RENT', amount: 8000, total_amount: 8000, rent_month: feb,
        due_date: new Date(Date.UTC(2027, 1, 5)), status: 'UPCOMING',
        lifecycle_status: 'ACTIVE', settlement_status: 'UNPAID',
      },
    });

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id, email: owner.email, role: 'OWNER', owner_id: owner.id,
    });

    // See the note above Step 1 — replace this with the real identity-token
    // construction pattern found in this repo's existing tests before running.
    const identityToken = 'REPLACE_WITH_REAL_TEST_TOKEN_HELPER';

    const req = new Request(`http://localhost/api/tenants/${tenant.id}/change-rent`, {
      method: 'POST',
      body: JSON.stringify({
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: feb.toISOString(),
        reason: 'annual increment',
        identityToken,
      }),
    }) as any;

    const res = await POST(req, { params: { id: tenant.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.newRentAmount).toBe(9000);
    expect(body.data.obligationsUpdated).toBe(1);
  });

  it('rejects requests with no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = new Request('http://localhost/api/tenants/irrelevant/change-rent', { method: 'POST', body: '{}' }) as any;
    const res = await POST(req, { params: { id: 'irrelevant' } });
    expect(res.status).toBe(401);
  });

  it('rejects a hostel the caller does not own', async () => {
    const owner = await createTestOwner();
    const otherOwner = await createTestOwner();
    const otherHostel = await createTestHostel(otherOwner.id);
    const tenant = await createTestTenant(otherOwner.id, otherHostel.id);

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id, email: owner.email, role: 'OWNER', owner_id: owner.id,
    });

    const req = new Request(`http://localhost/api/tenants/${tenant.id}/change-rent`, {
      method: 'POST',
      body: JSON.stringify({ hostelId: otherHostel.id, newRentAmount: 9000, effectiveFromMonth: new Date().toISOString(), reason: 'x', identityToken: 'x' }),
    }) as any;

    const res = await POST(req, { params: { id: tenant.id } });
    expect(res.status).toBe(403);
  });
});
```

**Note for the implementer:** before writing this test, run `grep -rn "identity_tokens.create\|IDENTITY_PURPOSE" backend-next/tests/*.test.ts backend-next/tests/integration/*.test.ts | head -20` to find how an existing test (there should be one for obligation waive/cancel) constructs a valid, unconsumed identity token row for a given user/purpose/action — copy that exact helper/pattern into this test file rather than inventing a new one or leaving the placeholder token string in place.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/change-rent-api.test.ts -v`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

First, find the tenant's active agreement and the `IDENTITY_PURPOSE`/`IDENTITY_ACTION` constant convention used by the obligation-cancel route (`grep -n "IDENTITY_PURPOSE\|IDENTITY_ACTION" backend-next/app/api/payments/obligations/\[id\]/cancel/route.ts`) and reuse the same constant style (e.g. a `"PAYMENT"` purpose with a distinct action string like `"CHANGE_RENT"`).

```ts
// backend-next/app/api/tenants/[id]/change-rent/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { applyRentChangeInTx } from "@/src/services/payments/rent-change-service";
import { verifyIdentityConfirmation, consumeIdentityTokenInTx } from "@/src/services/payments/identity-confirmation-guard";

const IDENTITY_PURPOSE = "PAYMENT"; // match whatever the real constant value is in cancel/route.ts
const IDENTITY_ACTION = "CHANGE_RENT";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, newRentAmount, effectiveFromMonth, reason, identityToken } = body;

    if (!hostelId) return ApiResponse.error(ApiError.badRequest("hostelId is required"));
    if (!(Number(newRentAmount) > 0)) return ApiResponse.error(ApiError.badRequest("newRentAmount must be greater than 0"));
    if (!effectiveFromMonth) return ApiResponse.error(ApiError.badRequest("effectiveFromMonth is required"));
    if (!reason) return ApiResponse.error(ApiError.badRequest("reason is required"));

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const identity = await verifyIdentityConfirmation(identityToken, IDENTITY_PURPOSE, IDENTITY_ACTION, session.sub);

    const agreement = await prisma.agreement.findFirst({
      where: {
        tenant_id: params.id,
        hostel_id: hostelId,
        status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] },
      },
      orderBy: { created_at: "desc" },
    });
    if (!agreement) return ApiResponse.error(ApiError.notFound("No active agreement found for this tenant"));

    const result = await prisma.$transaction(async (tx: any) => {
      await consumeIdentityTokenInTx(tx, identity.jti);
      return applyRentChangeInTx(tx, {
        agreementId: agreement.id,
        hostelId,
        newRentAmount: Number(newRentAmount),
        effectiveFromMonth: new Date(effectiveFromMonth),
        actorId: scope.actor_id,
        reason,
      });
    });

    return ApiResponse.success(result);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("IDENTITY_REQUIRED") || msg.startsWith("IDENTITY_EXPIRED")) {
      return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    }
    if (msg.startsWith("VALIDATION_ERROR")) return ApiResponse.error(ApiError.badRequest(msg.split(": ")[1] ?? msg));
    if (msg.includes("does not belong to hostel")) return ApiResponse.error(ApiError.forbidden(msg));
    return ApiResponse.error(ApiError.internal("Failed to change rent"));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/change-rent-api.test.ts -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Update `docs/obsidian/APIs.md` and `docs/obsidian/Business-Rules.md`**

`APIs.md`: add an entry for `POST /api/tenants/:id/change-rent` (auth OWNER/ADMIN + identity confirmation, body shape, response shape), matching the file's existing per-route format.

`Business-Rules.md`: add a section stating the new rule plainly: rent changes are immediate and owner-only (no tenant approval, unlike other Category C contractual fields); the owner picks an effective-from month; obligations at or after that month with zero recorded payments are repriced in place; obligations before that month, or with any payment, are never touched. Cross-reference `[[APIs]]`.

- [ ] **Step 6: Commit**

```bash
git add backend-next/app/api/tenants/[id]/change-rent backend-next/tests/integration/change-rent-api.test.ts docs/obsidian/APIs.md docs/obsidian/Business-Rules.md
git commit -m "feat(payments): add POST /api/tenants/:id/change-rent (identity-confirmed)"
```

---

### Task 5: Register `TENANT_CHANGE_RENT` OwnerAction

**Files:**
- Create: `backend-next/src/services/owner-actions/definitions/agreement-actions.ts`
- Modify: `backend-next/src/services/owner-actions/bootstrap.ts`
- Test: `backend-next/tests/integration/owner-actions.test.ts` (extend)

**Interfaces:**
- Consumes: `ownerActionRegistry` (existing, `backend-next/src/services/owner-actions/owner-action-registry.ts`).
- Produces: registers `actionId: "TENANT_CHANGE_RENT"`, `entity: "tenant"`, `category: "WORKFLOW"`, `label: "Change Rent"`, available whenever `tenantStatus === "ACTIVE"`.

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/owner-actions.test.ts`:
```ts
import '@/src/services/owner-actions/definitions/agreement-actions';

describe('agreement-actions definitions', () => {
  it('registers TENANT_CHANGE_RENT, available only for ACTIVE tenants', () => {
    expect(ownerActionRegistry.has('TENANT_CHANGE_RENT')).toBe(true);

    const activeList = ownerActionRegistry.listForEntity('tenant', { tenantStatus: 'ACTIVE', actorRole: 'OWNER' });
    const action = activeList.find((a) => a.actionId === 'TENANT_CHANGE_RENT');
    expect(action?.available).toBe(true);
    expect(action?.label).toBe('Change Rent');
    expect(action?.category).toBe('WORKFLOW');

    const invitedList = ownerActionRegistry.listForEntity('tenant', { tenantStatus: 'INVITED', actorRole: 'OWNER' });
    expect(invitedList.find((a) => a.actionId === 'TENANT_CHANGE_RENT')?.available).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/owner-actions/definitions/agreement-actions.ts
import { ownerActionRegistry } from "../owner-action-registry";

ownerActionRegistry.register({
  actionId: "TENANT_CHANGE_RENT",
  entity: "tenant",
  category: "WORKFLOW",
  label: "Change Rent",
  allowedRoles: ["OWNER"],
  isAvailable: (ctx) => ctx.tenantStatus === "ACTIVE",
});
```

Add the import to `backend-next/src/services/owner-actions/bootstrap.ts`:
```ts
import "./definitions/agreement-actions";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: PASS, all existing tests + 1 new.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/owner-actions/definitions/agreement-actions.ts backend-next/src/services/owner-actions/bootstrap.ts backend-next/tests/integration/owner-actions.test.ts
git commit -m "feat(owner-actions): register TENANT_CHANGE_RENT action"
```

---

### Task 6: Frontend — `ChangeRentModal` + wiring + docs

**Files:**
- Modify: `frontend-v2/src/features/tenants/api/index.js` (confirm actual extension — `.js` or `.ts` — by listing the directory first)
- Create: `frontend-v2/src/app/components/modals/ChangeRentModal.tsx`
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Produces: `tenantService.changeRent(tenantId, { hostelId, newRentAmount, effectiveFromMonth, reason, identityToken })`.

- [ ] **Step 1: Confirm the real file extension and existing patterns in `tenants/api`**

Run: `ls frontend-v2/src/features/tenants/api/` and `grep -n "^export const tenantService" -A 5 frontend-v2/src/features/tenants/api/index.*` to see the exact object/export shape before adding a method to it.

- [ ] **Step 2: Add the `changeRent` API method**

Add to the `tenantService` object (matching whatever the file's existing method style looks like — likely a plain `api.post(...)` call returning unwrapped data, mirroring other methods already in this file):
```ts
changeRent: async (tenantId, { hostelId, newRentAmount, effectiveFromMonth, reason, identityToken }) => {
  const response = await api.post(`/tenants/${tenantId}/change-rent`, {
    hostelId, newRentAmount, effectiveFromMonth, reason, identityToken,
  });
  return response.data?.data ?? response.data;
},
```

- [ ] **Step 3: Build `ChangeRentModal.tsx`**

Read `frontend-v2/src/features/tenants/components/financial/WaiveObligationModal.tsx` in full first (identity-confirmation flow: password field → `identityService.confirmIdentity(password, 'PURPOSE')` → `identity.identity_token` → passed to the mutation) and copy its exact identity-step UI/flow structure.

```tsx
// frontend-v2/src/app/components/modals/ChangeRentModal.tsx
import { useState } from 'react';
import { X, TrendingUp, Loader2, CheckCircle2 } from 'lucide-react';
import { ErrorCard } from '@/shared/ui/error/ErrorCard';
import { getHmsError } from '@lib/errors';
import { identityService } from '@features/auth/api';
import { tenantService } from '@features/tenants/api';

interface UpcomingObligation {
  id: string;
  rent_month: string; // ISO date
  amount: number;
}

interface ChangeRentModalProps {
  tenantId: string;
  hostelId: string;
  currentRent: number;
  upcomingObligations: UpcomingObligation[]; // pass the tenant page's already-loaded, zero-payment UPCOMING/PENDING rent obligations
  onClose: () => void;
  onSuccess: () => void;
}

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function ChangeRentModal({ tenantId, hostelId, currentRent, upcomingObligations, onClose, onSuccess }: ChangeRentModalProps) {
  const [newRentAmount, setNewRentAmount] = useState(String(currentRent));
  const [effectiveFromMonth, setEffectiveFromMonth] = useState(upcomingObligations[0]?.rent_month ?? '');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'FORM' | 'CONFIRM'>('FORM');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);

  const affectedCount = upcomingObligations.filter((o) => o.rent_month >= effectiveFromMonth).length;

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (!(Number(newRentAmount) > 0)) {
      setFieldError('Enter a valid new rent amount.');
      return;
    }
    if (!effectiveFromMonth) {
      setFieldError('Choose the month the new rent should start from.');
      return;
    }
    if (!reason.trim()) {
      setFieldError('Enter a reason for this change.');
      return;
    }
    setStep('CONFIRM');
  };

  const handleConfirm = async () => {
    setApiError(null);
    setIsSubmitting(true);
    try {
      const identity = await identityService.confirmIdentity(password, 'CHANGE_RENT');
      const identityToken = identity?.identity_token ?? identity?.data?.identity_token;
      if (!identityToken) throw new Error('Identity verification failed. Invalid password.');

      await tenantService.changeRent(tenantId, {
        hostelId,
        newRentAmount: Number(newRentAmount),
        effectiveFromMonth,
        reason: reason.trim(),
        identityToken,
      });
      setSucceeded(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1200);
    } catch (err) {
      setApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button type="button" onClick={onClose} disabled={isSubmitting} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted text-muted-foreground disabled:opacity-50">
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
          <div className="p-2 rounded-xl bg-accent/10 text-accent">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Change Rent</h3>
            <p className="text-xs text-muted-foreground">Applies immediately — no tenant approval required</p>
          </div>
        </div>

        {succeeded ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-foreground">Rent updated</p>
          </div>
        ) : step === 'FORM' ? (
          <form onSubmit={handleContinue} className="space-y-4">
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>Current rent</span>
              <span className="font-semibold text-foreground">{fmt(currentRent)}/month</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">New rent amount <span className="text-rose-500">*</span></label>
              <input
                type="number" min="1" step="1" value={newRentAmount}
                onChange={(e) => setNewRentAmount(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Apply starting from <span className="text-rose-500">*</span></label>
              <select
                value={effectiveFromMonth}
                onChange={(e) => setEffectiveFromMonth(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                {upcomingObligations.map((o) => (
                  <option key={o.id} value={o.rent_month}>{monthLabel(o.rent_month)}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground px-1">
                {affectedCount} upcoming installment{affectedCount === 1 ? '' : 's'} will change to {fmt(Number(newRentAmount || 0))}.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Reason <span className="text-rose-500">*</span></label>
              <textarea
                required rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Annual rent increment"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {fieldError && <ErrorCard title="Please check the form" description={fieldError} action="Correct the field above and try again." compact />}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold">Cancel</button>
              <button type="submit" className="px-4 h-10 rounded-xl bg-accent text-accent-foreground text-sm font-semibold">Continue</button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-2xl p-4 border border-border/40 text-xs space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">New rent</span><span className="font-semibold text-foreground">{fmt(Number(newRentAmount))}/month</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Starting</span><span className="font-semibold text-foreground">{monthLabel(effectiveFromMonth)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Installments affected</span><span className="font-semibold text-foreground">{affectedCount}</span></div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Confirm your password <span className="text-rose-500">*</span></label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {apiError != null && <ErrorCard error={getHmsError(apiError, 'Change rent')} compact onRetry={() => setApiError(null)} retryLabel="Dismiss" />}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setStep('FORM')} disabled={isSubmitting} className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold disabled:opacity-50">Back</button>
              <button
                type="button" onClick={handleConfirm} disabled={isSubmitting || !password}
                className="px-4 h-10 rounded-xl bg-accent text-accent-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Confirm Change</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Note for the implementer:** confirm `identityService.confirmIdentity`'s exact return shape and the `identity_token` field name by reading `WaiveObligationModal.tsx` directly (already cited above) before finalizing this file — the code above mirrors what was found in this session's research but re-verify before committing.

- [ ] **Step 4: Wire the entry point in `TenantProfilePage.tsx`**

Add state: `const [showChangeRent, setShowChangeRent] = useState(false);`

Find where the Financial section's obligations list is already fetched (the same data `RentObligationList` renders from) and filter it for the modal's `upcomingObligations` prop:
```ts
const upcomingRentObligations = (obligations ?? [])
  .filter((o: any) => o.obligation_type === 'RENT' && o.settlement_status === 'UNPAID' && o.lifecycle_status === 'ACTIVE')
  .map((o: any) => ({ id: o.id, rent_month: o.rent_month, amount: Number(o.amount) }))
  .sort((a: any, b: any) => a.rent_month.localeCompare(b.rent_month));
```
(Adjust the exact source variable name — `obligations`/`duesData`/whatever this page's existing obligations query is called — to match what's actually already loaded on this page; do not add a second obligations fetch.)

Add a "Change Rent" entry point near the existing agreement/financial action buttons (read the existing `PrimaryActionsBar` render call from prior session work and place a similarly-styled button nearby, or add it as a new item in that bar if it accepts an actions array — check the component's actual structure before deciding placement), wired to `onClick={() => setShowChangeRent(true)}`.

Render the modal:
```tsx
{showChangeRent && (
  <ChangeRentModal
    tenantId={tenantId}
    hostelId={hostelId}
    currentRent={Number(agreement?.contract_rent ?? 0)}
    upcomingObligations={upcomingRentObligations}
    onClose={() => setShowChangeRent(false)}
    onSuccess={() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.obligations(hostelId, tenantId) });
      refetch();
    }}
  />
)}
```
(Match `agreement?.contract_rent`'s real source — find wherever this page already loads/displays the active agreement's rent, e.g. in the "Rent Agreement" summary card visible in the page's header, and reuse that same data rather than fetching it again.)

- [ ] **Step 5: Verify by reading the code back and running the build**

Confirm: the month dropdown only lists genuinely zero-payment upcoming obligations (matches the backend's own guard, so the preview count the owner sees is never wrong), `currentRent` reflects the real current contract rent, and the identity-confirmation step blocks submission until a password is entered.

Run from `frontend-v2/`: `npm run build` — expected pass.

- [ ] **Step 6: Update docs**

`docs/obsidian/Features.md`: add an entry for "Change Rent" — immediate, owner-only, identity-confirmed, month-scoped repricing. Cross-reference `[[APIs]]` and `[[Business-Rules]]`.
`docs/obsidian/Changelog.md`: add a bullet under `## [Unreleased]` → `### Added`.

- [ ] **Step 7: Commit**

```bash
git add frontend-v2/src/features/tenants/api frontend-v2/src/app/components/modals/ChangeRentModal.tsx frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx docs/obsidian/Features.md docs/obsidian/Changelog.md
git commit -m "feat(payments): add Change Rent modal and wire into Tenant Details page"
```

---

## Self-Review

**1. Spec coverage:** Part A — Transfer UI (Task 1), guided wrong-amount flow (Task 2). Part B — service (Task 3), API route (Task 4), OwnerAction registration (Task 5), frontend modal + wiring (Task 6). All six requirements from the brief are covered.

**2. Placeholder scan:** Task 4's test has one flagged, explicit gap (`identityToken = 'REPLACE_WITH_REAL_TEST_TOKEN_HELPER'`) with a concrete instruction (grep for the real existing test pattern) rather than an invented fake — this is the one deliberate exception, called out rather than guessed, consistent with how the same situation was handled in the prior Payment Corrections plan's Task 6.

**3. Type consistency:** `RentChangeResult`'s fields (`obligationsUpdated`, `updatedObligationIds`, `oldRentAmount`, `newRentAmount`, `effectiveFromMonth`) are used identically in Task 3's service, Task 4's route response, and Task 6's frontend (via the API wrapper's passthrough). `applyRentChangeInTx`'s parameter names match between Task 3's definition and Task 4's call site.
