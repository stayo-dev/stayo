# Move-Out Status Reconciliation Report

Date: 2026-06-13

## Purpose

This report reconciles the current move-out status model before the Move-Out Settlement Hardening Release.

No business logic changes should be implemented until the status contract below is accepted as the canonical model.

The core correction is:

- Physical exit is not financial settlement.
- Financial settlement is not workflow completion.
- Completion is only a terminal state after financial closure.

## Current Live Database Enum

Read-only query against the configured Postgres database returned the current `public."MoveOutStatus"` enum values:

```text
REQUESTED
SETTLEMENT_PENDING
APPROVED
VACATED
COMPLETED
REJECTED
```

Current live `move_out_requests.status` row usage:

```text
COMPLETED: 1
```

Observation:

The live database enum currently matches the Prisma enum. Extra statuses mentioned in older migration files are not present in the live enum.

## Current Prisma Enum

`apps/backend/prisma/schema.prisma` currently defines:

```text
REQUESTED
SETTLEMENT_PENDING
APPROVED
VACATED
COMPLETED
REJECTED
```

Prisma also contains a stale workflow comment describing:

```text
REQUESTED
INSPECTION_PENDING
INSPECTION_DONE
SETTLEMENT_APPROVED
PAYMENT_PENDING
COMPLETED
DISPUTED
PAYMENT_PENDING
```

That comment is not aligned with the active enum or runtime service.

## Current Runtime Statuses

The move-out state machine currently uses:

```text
REQUESTED
SETTLEMENT_PENDING
APPROVED
VACATED
COMPLETED
REJECTED
```

Current transition graph:

```text
REQUESTED -> SETTLEMENT_PENDING | REJECTED
SETTLEMENT_PENDING -> APPROVED | REJECTED
APPROVED -> VACATED
VACATED -> COMPLETED
COMPLETED -> terminal
REJECTED -> terminal
```

Current runtime write paths:

| Service action | Current status written |
|---|---|
| Create request | `REQUESTED` |
| Submit inspection | `SETTLEMENT_PENDING` |
| Approve settlement | `APPROVED` |
| Vacate bed | `VACATED` |
| Confirm payment and complete | `COMPLETED` |
| Reject/cancel request | `REJECTED` |

Current unsafe coupling:

- `vacate()` handles physical exit and room release.
- `confirmPaymentAndComplete()` marks settlement as settled, resolves disputes, waives outstanding rent obligations, and completes the workflow.
- Open disputes do not block completion.
- Payment status can be changed to settled without verified payment evidence.

## Current Frontend Statuses

Frontend status usage is inconsistent.

`apps/frontend/src/shared/types/moveout.ts` currently lists:

```text
REQUESTED
INSPECTION_PENDING
SETTLEMENT_PENDING
COMPLETED
CANCELLED
DISPUTED
```

Owner move-out workflow screens use:

```text
REQUESTED
SETTLEMENT_PENDING
APPROVED
VACATED
COMPLETED
REJECTED
```

Some hostel detail UI references:

```text
SETTLEMENT_APPROVED
PAYMENT_PENDING
DISPUTED
```

Frontend implication:

The frontend contains a mix of current runtime statuses, stale statuses, and desired future statuses. It must be updated atomically with the canonical lifecycle.

## Migration History Drift

The initial move-out migration created:

```text
REQUESTED
UNDER_REVIEW
AWAITING_SETTLEMENT
APPROVED
COMPLETED
CANCELLED
REJECTED
```

A later migration attempted to add:

```text
INSPECTION_PENDING
INSPECTION_DONE
SETTLEMENT_APPROVED
PAYMENT_PENDING
DISPUTED
```

Current live database does not contain those additional statuses.

There is also tenant status drift:

- Older docs and migrations reference `LEFT`.
- Current schema and service code use `FORMER_TENANT`.
- Future design must keep `FORMER_TENANT` as the physical tenant lifecycle state.
- Financial state must remain on the move-out/settlement receivable domain, not tenant status.

## Unused Statuses

These statuses are not part of the current live database enum and should not be introduced as canonical statuses:

```text
UNDER_REVIEW
AWAITING_SETTLEMENT
INSPECTION_PENDING
INSPECTION_DONE
PAYMENT_PENDING
DISPUTED
CANCELLED
LEFT
```

Notes:

- `DISPUTED` should remain a dispute overlay in `exit_disputes.status`, not a primary `move_out_requests.status`.
- `CANCELLED` should not be used for move-out requests; use `REJECTED` for cancelled/rejected terminal requests unless a later product requirement explicitly separates cancellation from rejection.
- `LEFT` should remain deprecated in favor of `FORMER_TENANT`.

## Deprecated Current Statuses

These current statuses should be replaced during the hardening release:

| Current status | Target replacement | Reason |
|---|---|---|
| `APPROVED` | `SETTLEMENT_APPROVED` | Clarifies what was approved. |
| `VACATED` | `PHYSICALLY_VACATED` or `SETTLEMENT_PENDING_PAYMENT` | Separates room release from financial closure. |

`COMPLETED` remains valid but must become a guarded financial terminal state.

## Target Status Model

Canonical lifecycle:

```text
REQUESTED
SETTLEMENT_PENDING
SETTLEMENT_APPROVED
PHYSICALLY_VACATED
SETTLEMENT_PENDING_PAYMENT
COMPLETED
REJECTED
```

### REQUESTED

Move-out request exists and awaits inspection/review.

### SETTLEMENT_PENDING

Inspection and settlement calculation are pending or in progress.

### SETTLEMENT_APPROVED

Owner has approved the settlement calculation.

This does not mean:

- tenant has left
- room is released
- receivable is paid
- workflow is complete

### PHYSICALLY_VACATED

Tenant has physically left.

This means:

- room allocation is closed
- room can be reused
- tenant status is `FORMER_TENANT`
- physical exit date is recorded
- room release date is recorded

This does not mean:

- settlement is paid
- settlement is waived
- dispute is resolved
- move-out is complete

### SETTLEMENT_PENDING_PAYMENT

Tenant owes owner money after settlement approval and an outstanding settlement receivable exists.

This means:

- room may already be reused
- tenant may already be `FORMER_TENANT`
- financial case remains open
- settlement receivable balance is greater than zero

### COMPLETED

Terminal financial completion.

Allowed only when:

```text
outstanding settlement = 0
AND no open dispute
AND verified payment evidence exists
```

or:

```text
approved write-off evidence exists
```

### REJECTED

Terminal rejected/cancelled request. No room release or settlement collection should be inferred.

## Target Transition Graph

```text
REQUESTED -> SETTLEMENT_PENDING | REJECTED
SETTLEMENT_PENDING -> SETTLEMENT_APPROVED | REJECTED
SETTLEMENT_APPROVED -> PHYSICALLY_VACATED
PHYSICALLY_VACATED -> SETTLEMENT_PENDING_PAYMENT | COMPLETED
SETTLEMENT_PENDING_PAYMENT -> COMPLETED
COMPLETED -> terminal
REJECTED -> terminal
```

Completion from `PHYSICALLY_VACATED` is allowed only when no receivable is outstanding and no dispute is open.

Completion from `SETTLEMENT_PENDING_PAYMENT` is allowed only after payment, dispute resolution, or write-off evidence closes the receivable.

## Tenant Status Rule

Do not create `FORMER_TENANT_PENDING_SETTLEMENT`.

Use:

```text
tenant.status = FORMER_TENANT
move_out_requests.status = SETTLEMENT_PENDING_PAYMENT
```

Tenant status represents physical lifecycle.

Move-out status and settlement receivable status represent financial lifecycle.

## Settlement Receivable Status Model

Create a dedicated settlement receivable domain linked to `exit_settlement_transactions`.

Minimum receivable statuses:

```text
CREATED
PARTIALLY_PAID
PAID
WAIVED
```

Receivable status must not be consumed automatically by:

- dashboard pending rent
- tenant dues
- tenant score
- rent reminders
- WhatsApp dues
- portfolio collection metrics

## Payment Flow Model

Add payment flow:

```text
MOVE_OUT_SETTLEMENT
```

This flow reuses payment infrastructure without turning settlement receivables into rent obligations.

Allowed reuse:

- `payment_attempts`
- PhonePe provider flow
- manual payment recording
- receipts
- reconciliation

Required separation:

- rent collection flow remains rent-only
- settlement collection flow closes settlement receivables only
- normal rent payment allocation must not consume settlement receivable balances
- settlement payment allocation must not consume rent obligations

## Settlement Ledger Audit Trail

Every settlement-changing action must generate an immutable audit event.

Required event types:

```text
SETTLEMENT_CREATED
SETTLEMENT_APPROVED
PHYSICAL_EXIT_RECORDED
SETTLEMENT_PAYMENT_RECEIVED
SETTLEMENT_PARTIALLY_PAID
SETTLEMENT_WRITTEN_OFF
SETTLEMENT_COMPLETED
DISPUTE_OPENED
DISPUTE_RESOLVED
```

Reason:

Move-out settlement collection can remain open after the tenant is physically gone and marked `FORMER_TENANT`.
Support, owner, and finance investigations need an immutable event history that explains every balance-changing action.

## Migration Strategy

### Step 1: Add New Enum Values

Add to `MoveOutStatus`:

```text
SETTLEMENT_APPROVED
PHYSICALLY_VACATED
SETTLEMENT_PENDING_PAYMENT
```

Postgres enum values cannot be dropped safely in-place. Since the live database currently has only the six active values, this release only needs additive enum migration.

### Step 2: Deploy Code That Can Read Old and New Statuses

Before backfill, runtime code should tolerate:

```text
APPROVED
VACATED
SETTLEMENT_APPROVED
PHYSICALLY_VACATED
SETTLEMENT_PENDING_PAYMENT
```

This avoids a partial deployment breaking active rows.

### Step 3: Create Settlement Receivable Schema

Create the settlement receivable table before backfilling statuses so migrated `VACATED` rows can be classified using outstanding balance.

### Step 4: Backfill Existing Rows

Backfill rules:

| Existing status | Backfill status |
|---|---|
| `REQUESTED` | `REQUESTED` |
| `SETTLEMENT_PENDING` | `SETTLEMENT_PENDING` |
| `APPROVED` | `SETTLEMENT_APPROVED` |
| `VACATED` with outstanding tenant-payable receivable | `SETTLEMENT_PENDING_PAYMENT` |
| `VACATED` with no outstanding receivable | `PHYSICALLY_VACATED` |
| `COMPLETED` | `COMPLETED` |
| `REJECTED` | `REJECTED` |

Current live data contains only one `COMPLETED` row, so production backfill risk is low based on current observed data.

### Step 5: Remove Old Runtime Writes

After backfill:

- stop writing `APPROVED`
- stop writing `VACATED`
- keep reading them only for defensive compatibility

### Step 6: Update Frontend Status Constants

Replace stale frontend statuses with the canonical lifecycle.

Remove from frontend move-out status constants:

```text
INSPECTION_PENDING
CANCELLED
DISPUTED
PAYMENT_PENDING
VACATED
APPROVED
```

Add:

```text
SETTLEMENT_APPROVED
PHYSICALLY_VACATED
SETTLEMENT_PENDING_PAYMENT
```

### Step 7: Update Documentation

Update:

- data-model enum docs
- move-out module docs
- tenant module docs using `LEFT`
- WhatsApp assistant docs for move-out settlement money-at-risk signals

## Required Code Touchpoints

### Backend

- `apps/backend/prisma/schema.prisma`
- `apps/backend/lib/services/move-out-state-machine.ts`
- `apps/backend/lib/services/move-out-service.ts`
- `apps/backend/app/api/move-out/requests/[id]/complete/route.ts`
- `apps/backend/app/api/move-out/requests/[id]/vacate/route.ts`
- `apps/backend/app/api/cron/move-out-releases/route.ts`
- `apps/backend/lib/services/move-out-notifications.ts`
- `apps/backend/lib/services/notifications/owner-whatsapp-assistant.ts`
- `apps/backend/lib/services/notifications/briefing-engine.ts`
- `apps/backend/src/services/payments/financial-domain.ts`
- `apps/backend/src/services/payments/merchant-context.ts`
- `apps/backend/src/services/payments/payment-service.ts`

### Frontend

- `apps/frontend/src/shared/types/moveout.ts`
- `apps/frontend/src/features/tenants/components/moveout/MoveOutStepper.tsx`
- `apps/frontend/src/app/components/views/MoveOutsView.tsx`
- `apps/frontend/src/features/tenants/components/profile/ExitWorkflowSection.tsx`
- `apps/frontend/src/portal/pages/TenantMoveOutPage.tsx`
- `apps/frontend/src/features/tenants/components/badges/TenantStatusBadge.tsx`
- `apps/frontend/src/app/components/hostel-detail/tabs/OverviewTab.tsx`
- `apps/frontend/src/app/components/hostel-detail/tabs/MoveOutsTab.tsx`

## Guard Rules For Implementation

### Completion Guard

Return:

```text
409 SETTLEMENT_NOT_RESOLVED
```

when any of these are true:

- settlement receivable outstanding amount is greater than zero
- open dispute exists
- payment evidence is missing
- write-off evidence is missing when balance was waived

### Dispute Guard

Open dispute blocks completion.

The system must never auto-resolve disputes during completion.

### Cron Guard

Move-out release cron may:

- release room
- close allocation
- set tenant `FORMER_TENANT`
- record physical exit fields

Move-out release cron must never:

- waive rent obligations
- settle balances
- mark settlement paid
- complete move-out

## Readiness Verdict

Implementation is approved after this reconciliation report, with one constraint:

The first implementation commit must reconcile status/schema/runtime/frontend usage before changing settlement business logic.

The original small fix remains rejected.

Do not:

- block room release until payment
- create move-out debt inside `rent_obligations`
- complete move-out on unverified manual payment text
- use tenant status to represent settlement debt

Do:

- separate physical exit from financial completion
- create a settlement receivable domain
- add `MOVE_OUT_SETTLEMENT` payment flow
- hard-block completion until financial closure is evidenced
- keep former tenants collectible through the move-out settlement domain

## Release Gates

Production deployment is blocked until all gates pass:

- status migration
- receivable schema migration
- completion guard tests
- dispute guard tests
- physical vacate versus completion tests
- payment flow tests
- WhatsApp settlement visibility tests
- dashboard contamination tests
- rent allocation isolation tests
- backfill dry-run report
