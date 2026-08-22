# Owner "Money in" — Design

**Date:** 2026-08-23
**Status:** Implemented
**Supersedes a non-goal of:** `2026-08-17-owner-settlements-design.md`, which explicitly listed
"tenant-facing or owner-facing settlement views" as out of scope. This is that view.
**Related:** [[Decisions]] ADR-090

## The problem the 2026-08-17 design left open

Migration 070 built the payout pipeline for the **admin who executes it**: what Stayo owes, to
whom, whether it has been transferred. It answers *"who do I pay tonight."*

The owner — whose money it is — could see none of it. The only owner-facing settlement route was
`GET/PUT /api/owner/payout-account`. Two questions had no answer anywhere in the product:

- *"When does this reach my bank?"*
- *"Which of my tenants paid it?"*

And a third problem was structural rather than missing: **nothing wrote `gateway_transactions`.**
The Razorpay webhook routed into `paymentService.handlePaymentWebhook` and never created a row, so
the settlement engine had a reader and no writer. Verified against live data: 0 gateway
transactions, 0 successful payment attempts.

## What an owner is actually anxious about

Not "is Stayo honest?" in the abstract. Two concrete things:

**1. His own due dates are bigger than his rent income.** Building lease (most owners lease rather
than own) on the 1st–5th, staff on the 1st, mess supplier weekly, electricity mid-month. Rent
arrives 1st–10th. He lives in that gap every month. So a payout **date** is not a status detail,
it is the product — and *predictability beats speed*, because he can plan around a consistent T+2
and cannot plan around "usually fast."

**2. Online rent stole his sense of receipt.** In cash, payment is an event he witnesses. Paid
through Stayo, the money lands in *Stayo's* account and the event becomes invisible. Online rent
can therefore feel like **less** control than cash — fatal, because he is the one who has to push
tenants to use it, and if he stops, the pipeline that feeds all of this has nothing in it.

## The model: four states, and they must add up

| State | Source | Who holds it |
|---|---|---|
| Owed | `rent_obligations` via `collectionQueueService` | nobody |
| Paid to you directly | `payments` with `payment_attempt_id IS NULL` | the owner |
| With Stayo | captured `TENANT_RENT` txns whose item is not `PAID` | **Stayo** |
| In your bank | captured txns whose item is `PAID` | the owner |

Conservation is **structural, not asserted**: `settlement_item_transactions.transaction_id` is
already `UNIQUE`, so a captured rupee is in exactly one of the last two, always. Totals are
*derived from* their parts (`assembleMonth`) rather than computed separately and validated, so
there is no code path where a rupee is shown twice or lost.

Two rules follow:

- **A `FAILED` transfer stays inside "With Stayo."** It is money Stayo still holds. A total that
  shrinks when a transfer fails is the fastest way to lose an owner.
- **"Paid to you directly" is never summed into anything Stayo owes.** Mixed once, every later
  number is suspect. Note this is a *display* distinction only — settleability still comes solely
  from `gateway_transactions`, per migration 070.

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Where it lives | Inside Collections, not a fourth tab — a separate tab makes the owner reconcile two screens himself |
| 2 | What leads | A compact payout strip on top; the existing dues queue keeps the body |
| 3 | The promise | **T+2 working days**, computed at run creation and **stored** (`expected_payout_date`) |
| 4 | Hostel filter | Payouts ignore it; the per-hostel split lives inside a payout's breakdown |
| 5 | Gateway ingestion | In scope — otherwise the screen is permanently empty |
| 6 | Owner-facing vocabulary | The word "settlement" never appears; a test asserts it |

On (3): stored, not recomputed. A promise derived at read time can never be *missed* — it just
quietly moves. Stored, it becomes a fact `paid_at` can be measured against, which is what lets the
kept-promise counter be false when it is false. Weekends are skipped; **bank holidays are not
modelled**, deliberately — a payout falling on Diwali is reported late, honestly, rather than the
promise being bent to cover it.

On (4): a payout is one bank transfer covering every hostel at once. A filtered payout figure would
match no line in his passbook, and the passbook is the document he trusts more than us.

## The screen

**Strip** (Collections, above the dues list). An *event* line, not a status line:
`3 tenants paid today · ₹18,500 / in your bank by Wed 27 Aug`, then the payers by name and time,
then `Stayo takes ₹0 · Last 8 payouts — all on time`.

Voice priority is strict and tested: **failed › paid today › pending › settled › never**. A failure
outranks all good news; an owner told only the pleasant half of the truth trusts the pleasant half
less next time. On failure the strip carries a one-tap route to the payout-account form, because
only he can correct his own bank details.

**`/owner/money/payouts`** — the month reconciliation block (five nested lines that add up, plus
"still to collect" linking back to the dues queue), the promise counter, and the payout list.
Search matches **UTR, amount, or tenant name**, because he reads his bank statement first and the
app second.

Each payout expands into the tenants who paid it, with `Collected / Stayo fee ₹0 / You received`.
**The expansion is the feature** — a payout he cannot open into names is a number Stayo asserts;
opened, it is a claim he can check by phoning someone. Verifiability beats accuracy he has no way
to audit. `Stayo fee ₹0` renders always: an unstated zero reads as a fee somebody chose not to
mention.

## Ingestion

`recordCapturedRentInTx` writes `gateway_transactions` inside the **same transaction** that settles
the payment, at all three settlement paths in `finalizePaymentAttempt` (advance, deposit, rent).

Three safety properties, each with a reason:

- **Inside a savepoint.** A failed statement aborts the whole Postgres transaction, so a plain
  try/catch would be a lie — the settlement would roll back anyway. Concretely: deploying ahead of
  migration 075 would otherwise fail *every gateway payment in production*. The savepoint makes
  recording the settlement record genuinely optional relative to taking the money, which is the
  correct priority.
- **No provider payment id → no row.** Without it there is no idempotency key and a replayed
  webhook creates a second settleable row: Stayo pays twice. Skipping under-settles, which an
  admin can see and correct.
- **Amount is the attempt amount in rupees**, with the provider's paise figure preserved under
  `raw.__provider_amount_paise`. Taking the provider number directly is a 100× error waiting to
  happen in a table that decides bank transfers, and there are zero captured payments in any
  environment to verify the payload shape against yet.

## Schema (migration 075)

```
settlement_items.expected_payout_date  DATE NULL   -- the promise, fixed when made
gateway_transactions.tenant_id         UUID NULL   -- who paid; attribution only
```

**Deliberately absent from `prisma/schema.prisma`.** Declaring a scalar makes every unselected read
of that table demand the column — the 2026-08-22 hostel-listings outage. All access is raw SQL, so
application code is correct whether or not 075 has been applied. `items()` falls back to a
promise-less query; the summary settles each source independently rather than `Promise.all`, so one
unreadable column cannot blank the other three.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/owner/payouts/summary` | strip facts + month block + promise counter |
| GET | `/api/owner/payouts?q=` | payout history; search by UTR / amount / tenant |
| GET | `/api/owner/payouts/:itemId` | which tenants make up one payout |

All owner-scoped via `resolveOwnerScope(session)`. **No `ownerId` parameter exists on any of them.**
A payout belonging to another owner returns **404, not 403** — the two must be indistinguishable or
the route becomes a way to probe for other owners' payouts.

The summary returns **facts, not a headline**. The strip's sentence is chosen client-side in
`payoutState.ts`, so owner-facing copy is not a backend deploy and the same numbers stay reusable.

## Non-goals

- **Statement export (PDF/CSV).** Deferred. Real value for a CA at tax time and for working-capital
  loan documentation, where hostel owners are famously under-documented.
- WhatsApp payout notifications — needs Meta template approval (multi-week); in-app ships now.
- Automated payouts. Every transfer is still made by a human and *recorded*.
- Refunds and chargebacks — still unmodelled, carried over from the 2026-08-17 design.

## Verification performed

- 17 pure backend tests (`test:pure`), 18 pure frontend tests.
- Migration + all four read-model queries executed against the **live database inside a rolled-back
  transaction**; replay of a gateway insert confirmed a genuine no-op (`INSERT 0 0`).
- 8 money-safety assertions run against live Postgres with real synthetic rows, then rolled back:
  subscription revenue never settles, uncaptured money never settles, a FAILED transfer stays
  counted, another owner's payouts are unreachable, one payment cannot join two payouts, and both
  conservation identities hold.
- `tsc` at its 539-error baseline in both apps (measured by stashing, not assumed); frontend build,
  architecture check and branding check pass; `check:invariants` at its pre-existing single failure.

**Not verified:** the Prisma client cannot reach the database from this sandbox (its query engine is
blocked; `psql` and `node-pg` both work), so the read model was verified at the SQL level rather
than through the ORM, and no request has been served end-to-end through a running server.
