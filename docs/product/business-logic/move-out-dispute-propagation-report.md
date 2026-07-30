# Move-Out Dispute Propagation Report

Date: 2026-06-13

## Scope

This report covers the move-out settlement dispute propagation fix.

It does not implement settlement receivables.

Disputes remain an overlay on `exit_disputes`; they are not represented as `move_out_requests.status`.

## Status

| Area | Result | Evidence |
|---|---|---|
| Tenant Confirmation | PASS | Tenant portal shows a persisted `Dispute Submitted` card with reference, disputed amount, status, and owner-review copy after dispute creation or refresh. |
| Owner Alert | PASS | Dashboard intelligence now adds a critical settlement-dispute alert with money at risk from active `exit_disputes`. |
| Owner Notification | PASS | Dispute creation and dispute updates create HMS notifications for owner and tenant through `notificationService`. |
| Timeline Event | PASS | Tenant timeline now emits dispute raised, reviewed, resolved, and rejected events from `exit_disputes`. |
| Activity Log | PASS | Dispute raised, reviewed, resolved, and rejected write `activity_logs` entries with `MOVE_OUT_DISPUTE` metadata. |
| WhatsApp Visibility | PASS | V3.2 `ACTIONS`/priority inbox reads active settlement disputes, ranks them before normal move-out work, and recommends `Review`. |
| Completion Guard | PASS | Settlement approval and move-out completion now return `409 DISPUTE_OPEN` or `409 DISPUTE_REVIEW_REQUIRED` while an active dispute exists. |
| Dashboard Visibility | PASS | Owner dashboard alert data includes active settlement dispute count and disputed money at risk. |

## Propagation Chain

```text
Tenant raises dispute
  -> exit_disputes row created
  -> activity_logs row created
  -> owner HMS notification created
  -> tenant HMS confirmation notification created
  -> dashboard alert exposes money at risk
  -> WhatsApp ACTIONS exposes review signal
  -> settlement approval/completion blocked
  -> dispute resolution/rejection clears blocker
  -> completion can proceed
```

## Files Modified

- `apps/backend/app/api/move-out/requests/[id]/dispute/route.ts`
- `apps/backend/app/api/move-out/requests/[id]/settle/route.ts`
- `apps/backend/app/api/move-out/requests/[id]/complete/route.ts`
- `apps/backend/app/api/move-out/timeline/route.ts`
- `apps/backend/app/api/owner/activity-logs/route.ts`
- `apps/backend/lib/services/move-out-service.ts`
- `apps/backend/lib/services/move-out-notifications.ts`
- `apps/backend/lib/services/dashboard-service.ts`
- `apps/backend/lib/services/notifications/owner-whatsapp-assistant.ts`
- `apps/frontend/src/features/move-out/api/index.js`
- `apps/frontend/src/portal/pages/TenantMoveOutPage.tsx`
- `apps/frontend/src/app/components/views/MoveOutsView.tsx`

## Implementation Notes

Active dispute statuses are:

```text
OPEN
UNDER_REVIEW
```

Completion and settlement approval are blocked for both active statuses.

Dispute classification now normalizes legacy UI values:

```text
DEDUCTIONS -> DAMAGE_CHARGE_DISPUTE
RENT_DUES -> RENT_DUES_DISPUTE
DEPOSIT -> DEPOSIT_REFUND_DISPUTE
OTHER -> SETTLEMENT_DISPUTE
```

The tenant-facing dispute form now uses settlement-specific categories directly.

## Verification

Commands run:

```text
npm run build
```

Result:

```text
Frontend production build passed.
Architecture boundary check passed.
Production branding check passed.
```

Command run:

```text
DOTENV_CONFIG_PATH=../.env node -r dotenv/config ./node_modules/.bin/tsx -e "Promise.all([...move-out dispute imports]).then(() => console.log('move-out dispute modules import ok'));"
```

Result:

```text
move-out dispute modules import ok
```

Note:

The backend import smoke test first failed inside the filesystem sandbox because `tsx` could not create its local IPC socket under `/tmp`.
It passed when rerun with approved elevated execution.

## Remaining Risks

- Existing historical disputes with broad `RENT_DUES` or `DEDUCTIONS` labels are not backfilled.
- There is still no database-level partial unique index preventing multiple active disputes for a request; duplicate prevention is enforced in service logic.
- WhatsApp now surfaces dispute review work, but direct dispute review actions still open HMS rather than completing review entirely inside WhatsApp.
