# Billing

## What this does

The billing module helps owners understand dues, collections, payment attempts, cash flow, expenses, risk, and receipts. It is the operational center for money movement.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Billing dashboard | Chooses hostel finance context | Hostel list and finance entry |
| Financial control center | Main finance screen | KPIs, pipeline, ledger, risk, activity |
| Payment detail drawer | Explains one obligation or payment | Amounts, status, receipt actions |
| Record payment modal | Records offline collections | Tenant dues, amount, reference |
| Expenses workspace | Tracks business expenses | Ledger, categories, vendors, profit context |
| Tenant financials | Tenant-facing dues and payments | Obligations, history, advance ledger |

## Data it needs

- `paymentService.getAll(hostelId)` from `/payments`.
- `paymentService.getAllDues(hostelId)` from `/payments/dues`.
- `paymentService.getDetail(obligationId, hostelId)` from `/payments/:id`.
- `paymentService.recordOfflinePayment(data)` from `/payments/record-offline`.
- `paymentService.createIntent(data)` from `/payments/create-intent`.
- `paymentService.downloadReceipt(paymentId)` from `/payments/:id/receipt`.
- Dashboard finance endpoints for stats shell, deferred activity, deferred analytics, cash flow, funnel, and operations.
- `expenseService.getAll()` from `/expenses` for business-wide expenses.

## Data it produces

- `rent_obligations` through rent generation and initial onboarding.
- `paymentAttempt` records for hosted checkout.
- `payments` records for successful or offline payments.
- `receipts` and cached receipt PDFs.
- Reconciliation runs and operational anomalies.
- `expenses` records for business costs.

## Key components

- `BillingView` selects the billing surface.
- `FinancialControlCenter` composes the finance dashboard.
- `HealthBar` renders finance KPIs.
- `CollectionPipeline` shows overdue and collection state.
- `PaymentLedger` renders payments and obligations.
- `PaymentDetailDrawer` renders details and receipt actions.
- `TenantPaymentModal` creates tenant payments.
- `ExpensesTab` renders the business expense tracker.
- `AddExpenseModal` records fast owner expense entries.

## Business logic in this module

- Obligations are the source of truth for money owed.
- Payment attempts track provider checkout state.
- Payments allocate money against obligations.
- Late fees use a pure billing engine with grace days and caps.
- Reconciliation detects provider and ledger mismatches.
- Expenses are business-wide by default.
- `hostel_id` is optional metadata for search and filtering only.
- Expense totals never use hostel allocation logic.

## Business Expenses

Expenses track Sri Adithya Hostels business spending, not hostel-wise accounting.

| Concept | Rule |
|---|---|
| Required fields | Title, amount, category, payment method, expense date |
| Optional fields | Hostel reference, vendor, notes, recurring flag |
| Financial scope | Business-wide |
| Hostel reference | Metadata only |

**How this works:**
1. The owner records a business expense from the expenses tab or quick action.
2. The backend stores `hostel_id` only when a reference is supplied.
3. Category, vendor, revenue, and net profit calculations read all owner expenses.
4. The UI shows operational visibility without allocation or split workflows.

## How this works (step by step)

1. The owner opens `/billing` or a hostel finance surface.
2. The UI fetches the lightweight stats shell and payment ledger data.
3. Activity and analytics endpoints load after the critical finance cards.
4. The owner records offline payment or reviews online attempts.
5. Backend services update obligations, payments, attempts, and receipts.
6. Finance query keys refresh and the dashboard totals change.
7. Expense changes refresh business expense, dashboard, and portfolio caches.

## How to reuse this for a new client

- Keep obligations as the financial source of truth.
- Replace PhonePe credentials and settlement rules.
- Confirm offline payment methods and receipt format.
- Reconfigure late fee rules, due days, grace days, and caps.

**How this works:**
1. Rent generation creates obligations.
2. Collections create payments.
3. Reports read both to explain expected, collected, pending, and overdue money.
