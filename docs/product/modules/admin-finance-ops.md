# Admin Finance Ops

## What this does

Admin finance ops gives platform operators visibility into reconciliation, settlement batches, payment anomalies, webhook events, and platform revenue.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Admin dashboard | Summarizes platform finance | Revenue, settlement, anomaly metrics |
| Reconciliation | Reviews payment mismatches | Attempts, invoices, webhook events |
| Settlements | Tracks owner payouts | Batches, eligible credits, payable amounts |
| Settlement batch detail | Reviews one batch | Batch payments and reconciliation state |

## Data it needs

- Backend admin pages under `apps/backend/app/(dashboard)/admin`.
- Admin APIs under `/api/admin/finance-ops/*`.
- Settlement APIs under `/api/admin/settlements/*`.
- Admin auth context from `lib/auth/admin-ctx.ts`.

## Data it produces

- Reconciliation runs.
- Settlement batches.
- Admin audit logs.
- Financial invariant failure records.

## Key components

- `apps/backend/app/(dashboard)/admin/page.tsx` renders platform finance summary.
- `admin/reconciliation/page.tsx` renders reconciliation UI.
- `admin/settlements/page.tsx` renders settlement batches.
- `admin/settlements/[batchId]/page.tsx` renders batch detail.

## Business logic in this module

- Admin finance separates platform revenue from owner collections.
- Reconciliation compares local attempts, provider verification, and webhook events.
- Settlement ledger decides what is payable to owners.

## How this works (step by step)

1. An admin opens a protected admin route.
2. The page calls admin finance APIs.
3. Backend services aggregate attempts, invoices, anomalies, and settlement data.
4. The admin reviews mismatches or batch readiness.
5. Audit records preserve operational actions.

## How to reuse this for a new client

- Keep admin finance only if the platform collects money centrally.
- Remove or hide this module for direct-to-owner payment models.
- Replace settlement rules when provider payout logic changes.
- Confirm admin authentication before production use.

**How this works:**
1. Owner screens manage hostel operations.
2. Admin screens manage platform financial integrity.
3. Reconciliation protects money movement across the whole system.

