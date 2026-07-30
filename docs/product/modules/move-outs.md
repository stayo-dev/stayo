# Move Outs

## What this does

The move-out module manages tenant exit from request to inspection, settlement, payment, dispute, feedback, and completion.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Owner move-outs | Reviews hostel exits | Requests, statuses, tenant, settlement |
| Inspection form | Records room condition | Damage, deductions, notes |
| Settlement view | Confirms payable or refundable amount | Dues, deposit, deductions, owner-confirmed final amount |
| Tenant move-out page | Lets tenant request and track exit | Timeline, actions, dispute, feedback |

## Data it needs

- `moveOutService.listRequests(hostelId)` from `/move-out/requests`.
- `moveOutService.getRequest(id)` from `/move-out/requests/:id`.
- `moveOutService.getTimeline()` from `/move-out/timeline`.
- `moveOutService.submitRequest(payload)` from `/move-out/requests`.
- Owner actions for inspect, confirm settlement, complete, and dispute.

## Data it produces

- `move_out_requests` records.
- `move_out_inspections` and inspection items.
- Exit settlement transactions.
- Disputes and feedback.
- Tenant status and allocation release effects.
- Owner-confirmed settlement direction and amount.
- Physical move-out date used for room release.

## Key components

- `MoveOutsView` renders owner move-out operations.
- `TenantMoveOutPage` renders tenant exit workflow.
- `MoveOutStepper` renders tenant-visible status steps.
- `ExitWorkflowSection` shows active move-out state in tenant profile.

## Business logic in this module

- Valid statuses are controlled by the move-out state machine.
- Direct writes to completed status are banned by service design.
- Active move-outs can block transfers, rent generation, rent edits, and profile edits.
- Tenant-facing steps hide internal state complexity.
- Owners confirm the final settlement amount before the request moves to payment or completion.
- Completion stores the physical move-out date.
- If the move-out date is today or past, room release and tenant `LEFT` status happen immediately.
- If the move-out date is future, the cron release job completes the room and tenant status on that date.
- Legacy completed move-outs without `physical_exit_date` fall back to `actual_exit_date` or `planned_exit_date`.
- The backfill migration releases already-completed historical move-outs whose exit date has passed.

## How this works (step by step)

1. A tenant submits a move-out request.
2. The owner reviews the request in `/hostels/:hostelId/move-outs`.
3. The owner records inspection deductions.
4. The owner confirms whether the tenant pays, receives a refund, or has no payment due.
5. The backend snapshots that confirmed settlement.
6. If payment is needed, the owner records payment and move-out date.
7. The state machine validates each transition.
8. Completion releases or closes operational records on the move-out date.
9. The release cron also repairs old completed records that missed the physical exit date.

## How to reuse this for a new client

- Keep the state machine and capability guards.
- Customize inspection fields and deduction categories.
- Confirm refund and deposit settlement rules.
- Confirm whether tenant disputes are allowed.

**How this works:**
1. Status controls available actions.
2. Confirmed settlement becomes the persisted final net amount.
3. Capability checks prevent unsafe changes during exit.
4. The tenant sees a simplified progress tracker.
