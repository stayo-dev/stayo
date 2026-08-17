# Owner Settlements — Design

**Date:** 2026-08-17
**Status:** Awaiting review
**Design source:** `Stayo Admin.dc.html`, SETTLEMENTS section (three tabs, kanban board, settlement drawer)
**Related:** [[Decisions]] ADR-080 (the console this lives in)

## The business model, stated plainly

Tenants pay rent through Stayo. That money lands in **Stayo's own Razorpay account**, not the owner's. Stayo then pays each owner what their tenants paid.

**Stayo passes the money through in full. No commission is deducted.** The design's own banner says so, and it is the single most important fact about this feature: settlement is a *transfer pipeline*, not a revenue event. Nothing in this system may quietly retain a percentage.

The nightly job is therefore: *for each owner, how much did Stayo collect on their behalf today, and has it been paid on?*

## The rule that prevents Stayo paying money it never received

**Settleability is decided by the payment gateway ledger, never by the payment record.**

An owner marks rent as paid and picks a type — cash, UPI, bank transfer — and may enter a UPI reference. That is a *record of something that already happened between the tenant and the owner*, and it must keep working exactly as it does today. Nothing here blocks or changes it.

But such a record proves nothing about Stayo's bank balance. An owner-marked "UPI" payment looks online and is not: the money went to the owner's own UPI ID. Inferring settleability from `payments.payment_method`, or from `offline_recorded_by` being null, would therefore be wrong in the one direction that costs Stayo money.

So a payment is settleable **only if a gateway transaction exists for it**, confirming Razorpay actually received the funds into Stayo's account. The `payments` row is the operational record; the gateway ledger is the financial one. They are different things and this feature reads the second.

### Not all gateway money is the owner's

Two different kinds of money will land in the same Razorpay account:

| Purpose | Whose money | Settles? |
|---|---|---|
| `TENANT_RENT` | The owner's — Stayo is holding it | **Yes**, in full |
| `OWNER_SUBSCRIPTION` | **Stayo's own revenue** | **Never** |

Owners will pay for their subscription through the same gateway. That money is Stayo's income. If the run selected on "money in the Razorpay account" alone, every subscription payment an owner made would be handed straight back to them — Stayo would collect nothing, and the error would look like generosity rather than a bug.

The purpose is therefore recorded **at the moment the transaction is created**, not inferred later from which table happens to reference it. Inference breaks the first time a third money type appears (deposits, refunds, penalties), and it breaks silently.

```
model gateway_transactions
  id
  provider            String        -- razorpay
  provider_payment_id String @unique -- idempotency against webhook replay
  purpose             GatewayPurpose -- TENANT_RENT | OWNER_SUBSCRIPTION
  amount              Decimal
  status              String        -- CAPTURED | FAILED | REFUNDED
  captured_at         DateTime?
  -- exactly one of these is set, per purpose
  payment_id          String? @unique  -- TENANT_RENT -> the payments row
  hostel_id           String?          -- whose rent, for per-hostel totals
  owner_id            String?          -- who is owed, or who subscribed
  raw                 Json             -- the provider payload, kept verbatim
```

A settlement item is built from `gateway_transactions` where `purpose = TENANT_RENT`, `status = CAPTURED`, and `captured_at` falls in the run's day. Cash, direct UPI, and subscription income are all excluded by construction rather than by a filter someone must remember.

**This also fixes a subtler problem:** the settlement amount is now the money Stayo *actually holds*, at the amount the gateway captured — not the amount the owner typed into a form. Those can differ, and when they do the gateway is right.

## Decisions taken

| # | Decision | Choice |
|---|---|---|
| 1 | What settles | Only money Stayo actually received (online/gateway). Direct collections shown but excluded |
| 2 | Before the gateway exists | Build it live and correctly empty — ₹0 with an explanatory note, never seeded data |
| 3 | Run boundary | Calendar day, 00:00–23:59 **IST**. Late payments roll into the next run |
| 4 | Source of truth | The gateway ledger, not the payment record. Owner-marked payments are untouched |
| 5 | Gateway money is typed | `TENANT_RENT` settles; `OWNER_SUBSCRIPTION` is Stayo's revenue and never does |

On (2): fabricated rows in a financial screen are indistinguishable from real money owed. The same honest-gap rule as ADR-080, and it matters more here than anywhere else in the console.

## Schema

```
model settlement_runs
  id, run_date (date, unique)      -- one run per calendar day, IST
  status            DRAFT | IN_PROGRESS | COMPLETED
  gross_collected   Decimal        -- total online rent collected that day
  owner_count       Int
  created_by, created_at, completed_at

model settlement_items            -- one per owner per run
  id, run_id, owner_id
  amount            Decimal        -- what Stayo owes this owner. NEVER net of a fee
  payment_count     Int
  status            PENDING | PROCESSING | PAID | FAILED | CANCELLED
  -- payout record, all null until paid
  method            String?        -- BANK_TRANSFER | UPI | IMPS | NEFT
  reference         String?        -- UTR / UPI ref
  paid_at, paid_by  -- the admin who marked it, not a service account
  failure_reason    String?
  @@unique([run_id, owner_id])

model settlement_item_payments    -- which payments this item is made of
  item_id, payment_id
  @@unique([payment_id])          -- a payment can belong to exactly one item, ever

model settlement_audit_log
  id, run_id?, item_id?, action, detail (Json), actor_id, created_at
```

`settlement_item_payments` with a **unique constraint on `payment_id`** is what makes double-payment structurally impossible: a payment already attached to any run cannot be pulled into another. That is a database guarantee, not a query the next developer has to remember to write.

`amount` is deliberately not called `net` — there is no gross-vs-net here, and naming it `net` would invite a future fee field.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/settlements/run?date=` | Tonight's run: totals, lanes, per-owner items |
| POST | `/api/admin/settlements/run` | Create/refresh the run for a date (idempotent per date) |
| POST | `/api/admin/settlements/items/[id]/start` | PENDING → PROCESSING |
| POST | `/api/admin/settlements/items/[id]/paid` | PROCESSING → PAID; requires method + reference |
| POST | `/api/admin/settlements/items/[id]/fail` | PROCESSING → FAILED, with a reason |
| GET | `/api/admin/settlements/owners` | Directory: lifetime settled, this month, last payout |
| GET | `/api/admin/settlements/history` | Past runs + audit log |
| GET | `/api/admin/settlements/export` | CSV of a run |

The decommissioned `/api/admin/settlements/*` routes (currently 410 Gone) are replaced by these. Any not reused stay 410 rather than being deleted, so an old caller gets a clear answer.

## Rules the API enforces

1. **A payment belongs to at most one settlement item, ever.** Enforced by unique index, not by convention.
2. **Marking paid requires a method and a reference.** A payout with no UTR cannot be reconciled against a bank statement later, which is the entire point of recording it.
3. **PAID is terminal.** No un-paying. A mistake is corrected by a compensating record, never by mutating history — this is money that left a bank account.
4. **Only PROCESSING items can be marked paid.** The design's two-step (start → confirm) exists so nobody pays from a list view by mis-tap.
5. **`paid_by` is the signed-in admin**, never a service account. "Who paid this" must always answer with a person.
6. **Amounts are computed, never typed.** An admin cannot edit what is owed; they can only record what they transferred. If those disagree, that is a reconciliation problem to surface, not to paper over.
7. **A run for a past date is immutable once COMPLETED.**

## UI — per the design

**Tonight's run.** Pooled-account banner (total to settle, owners pending) with the pass-through statement kept verbatim, since it is the thing an admin must not misunderstand. Four summary cards. Progress bar + "Start all pending". Three-lane board — Pending / Processing / Paid — with drag between lanes; dragging to Paid opens the confirm drawer rather than paying, because a drag must never move money.

**Owners & hostels.** Search, status/plan/revenue/city filters, CSV export, table of lifetime settled / this month / last payout.

**History & logs.** Past runs with method breakdown, plus the audit log.

**Settlement drawer.** Payable hero + status; payout destination (bank fields, copy button); collection by hostel; the individual tenant payments making up the amount; and on a paid item, the receipt (method, UTR, settled at, by whom). Footer: PENDING → "Start payout"; PROCESSING → method picker + reference input + "Mark as paid" → irreversible-confirmation step naming the amount, the holder and the bank.

## Where the bank details come from

The **owner's own Settings page**, in a "Payout account" section: account holder name, account number (entered twice — a typo here sends money to a stranger and is unrecoverable), IFSC, and bank name. Stored on the owner and surfaced in the admin's settlement drawer.

The owner enters these themselves rather than an admin transcribing them from a call: it is their money, a mistyped digit is irreversible, and they are the only person who can check it against their own passbook. Admins can view but not edit.

Changing a payout account is a security-sensitive act — the obvious fraud is an attacker redirecting an owner's rent to their own account — so it should sit behind the existing step-up confirmation used for the other financially-sensitive owner routes, and the previous value should be kept in the audit log. A change while an item is `PROCESSING` must not alter that item; it already has its destination.

## Non-goals

- Automated payouts / Razorpay Payouts API. Every transfer is made by a human in their bank and *recorded* here.
- Commission, fees, or any deduction.
- Settling offline-collected rent.
- Tenant-facing or owner-facing settlement views. Admin only, for now.

## Verification

- `npm run check:financial-safety` and `check:invariants` must pass.
- Tests that matter most:
  - an owner-marked payment with method "UPI" and a reference, but no gateway transaction, is never settled — the exact case that looks online and is not;
  - an `OWNER_SUBSCRIPTION` transaction is never settled, even though it is captured gateway money;
  - a settlement item's amount equals the sum of its gateway transactions, not the sum of the `payments` rows;
  - a payment cannot be attached to two runs (constraint-level);
  - marking paid without a reference is refused;
  - a PAID item cannot be reopened;
  - run totals equal the sum of their items, which equal the sum of their payments;
  - a day with no online payments produces a valid empty run, not an error.

## Sequencing

1. Schema + migration 070; owner payout fields.
2. Run computation service + the offline-exclusion test, before any UI.
3. Run/lane/item endpoints with the state machine.
4. Tonight's-run UI: banner, cards, board, drawer.
5. Mark-paid flow with confirmation and audit logging.
6. Directory + history + CSV export.
7. Docs: ADR, `Database`, `APIs`, `Business-Rules`, `Changelog`.

Steps 1–2 are worth reviewing on their own: if the computation is wrong, everything above it is confidently wrong.

## Risks

- **Paying money Stayo never received** — the central risk; mitigated by the online-only rule and a dedicated test.
- **Double payment** — mitigated structurally by the unique index on `payment_id`.
- **Reconciliation drift.** Recorded payouts are what an admin *says* they transferred. Nothing verifies against a real bank statement, so a typo'd UTR is undetectable here. Automated reconciliation is out of scope but this is where it would go.
- **A gateway transaction with no purpose set** would be unsettleable-but-also-unattributed. The column is non-nullable and set at creation for exactly this reason.
- **Refunds and chargebacks are not modelled.** A payment settled to an owner and later refunded to the tenant leaves Stayo out of pocket. Worth deciding before the gateway goes live, not after.
