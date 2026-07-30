# Collection Pipeline

## Pipeline stages

| Stage | Meaning |
|---|---|
| Obligation created | Tenant owes money. |
| Due soon | Due date is approaching. |
| Overdue | Due date has passed. |
| Attempt created | Tenant or owner started payment. |
| Verification pending | Provider or owner confirmation is needed. |
| Paid | Payment is accepted and allocated. |
| Reconciled | Provider and local ledger agree. |

**How this works:**
1. Rent generation creates obligations.
2. Tenant or owner action creates payment attempts or offline payments.
3. Reconciliation confirms local records match provider evidence.

## Online payment flow

1. Tenant selects payable obligations.
2. UI calls `paymentService.createIntent`.
3. Backend creates `paymentAttempt`.
4. PhonePe hosts checkout.
5. Webhook or return verification updates attempt status.
6. Successful attempt creates `payments`.
7. Receipt generation makes PDF evidence available.

**How this works:**
1. Attempts track checkout state.
2. Payments track collected money.
3. Receipts provide user-facing proof.

## Offline payment flow

1. Owner opens `RecordPaymentModal`.
2. UI fetches current dues.
3. Owner enters amount, method, reference, and note.
4. UI calls `/payments/record-offline`.
5. Backend records payment and updates related obligations.

**How this works:**
1. Offline payments still use obligation IDs.
2. References make cash, UPI, or bank payments auditable.
3. Dashboard totals refresh after query invalidation.

## Reconciliation

Payment reconciliation checks attempts, provider verification snapshots, webhook events, and local payments.

**How this works:**
1. Cron or admin action starts reconciliation.
2. Services compare expected and actual status.
3. Anomalies become operational records for review.

> **Needs clarification:** Some v2 payment service methods call endpoints such as export, waive, and bulk generate. Matching backend routes were not confirmed for every method.

