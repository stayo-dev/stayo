# Payment-Reversed Activity Tag — Design Spec

## Problem

When an owner reverses a payment (`CorrectPaymentModal` → `PAYMENT_REVERSAL`), the
reversal is written as a `payments` row with `amount_paid` **negative** and
`reference_number = "REVERSAL:<originalPaymentId>"`. In the tenant Activity feed
it then renders **identically to a real incoming payment**: the tag reads
"Payment Received" (green, Banknote icon), and the body summary reads
`"₹-8,500 paid via ADVANCE_ADJUSTMENT"` — a negative amount next to the word
"paid," which is confusing and financially misleading (a reversal is money
*coming back out* / an entry being undone, not a receipt).

Goal: a reversal must read as its own distinct event in the activity feed —
correct tag, colour, icon, summary, and a signed amount — so an owner can tell a
reversal apart from a payment at a glance.

## Current behaviour (verified against code)

- **Backend** `backend-next/src/services/payments/financial-timeline-service.ts`
  emits reversals as ordinary `PAYMENT_RECORDED` events from two methods:
  - `getTenantTimeline` (tenant Activity feed; PAYMENT_RECORDED block ~line 371):
    `summary = \`₹${amount_paid} paid via ${payment_method}\``,
    `amount = Number(payment.amount_paid)` (negative for reversals),
    `metadata = { payment_method, payment_date }`. The payment `select`
    (~line 358) does **not** currently include `reference_number`.
  - `getObligationTimeline` (obligation history; PAYMENT_RECORDED block ~line 193):
    same shape, same omission.
- **Frontend** `frontend-v2/src/features/tenants/utils/financialColors.ts`
  `getEventDisplay()` maps `PAYMENT_RECORDED → { label: 'Payment Received', icon:
  Banknote, tone: 'green' }` unconditionally (no sign / reversal check). Its
  input is `Pick<TimelineEvent, 'type' | 'metadata'>`.
- **Frontend** `frontend-v2/src/features/tenants/components/financial/FinancialActivityCard.tsx`
  shows the card amount as `Math.abs(primary.amount)` (line 28) — which is why a
  −8,500 reversal displays as a positive ₹8,500 in the card header.
- **Grouping** `groupFinancialActivity.ts`: a reversal is a `PAYMENT_RECORDED`
  with **no** `payment_group_id`, so it falls through to the ungrouped branch and
  already renders as its own standalone card. No grouping change is needed.

A reversal is reliably identifiable by either signal, both already on the row:
`reference_number` starts with `"REVERSAL:"` (explicit), or `amount_paid < 0`
(a reversal is the only way a negative `payments.amount_paid` is created in this
system). The design uses the `REVERSAL:` prefix as the primary signal, with
`amount_paid < 0` as a defensive fallback.

## Design (Approach A — metadata flag + display branch)

Chosen over introducing a new `PAYMENT_REVERSED` timeline event type (Approach B),
which would ripple through the `TimelineEventType` unions on both ends, the
`matchesFinancialFilter` logic, and grouping — more surface for the same visible
result. Keeping the event as `PAYMENT_RECORDED` also keeps reversals under the
existing "Payments" filter chip, which is the correct bucket for them.

### 1. Backend — surface the reversal on the timeline event

In `financial-timeline-service.ts`, for **both** `getTenantTimeline` and
`getObligationTimeline` PAYMENT_RECORDED blocks:

- Add `reference_number` to the payment `select`.
- Derive `isReversal = payment.reference_number?.startsWith("REVERSAL:") ?? false`
  (fallback: `|| Number(payment.amount_paid) < 0`).
- Add to `metadata`: `is_reversal: isReversal`, and
  `reverses_payment_id: isReversal ? reference_number.slice("REVERSAL:".length) : undefined`.
- Rewrite the `summary` for reversals to use the **absolute** amount and undo
  language: `\`Reversal of ₹${absAmount.toLocaleString("en-IN")} payment\``.
  Non-reversal summary is unchanged (`\`₹${amount} paid via ${method}\``).
- `amount` stays `Number(payment.amount_paid)` (negative) — the frontend now
  renders the sign rather than discarding it.

### 2. Frontend — distinct display for a reversal

- `financialColors.ts::getEventDisplay`: in `case 'PAYMENT_RECORDED'`, branch on
  `event.metadata?.is_reversal`:
  - reversal → `{ label: 'Payment Reversed', icon: RotateCcw, tone: 'red' }`
  - else → existing `{ label: 'Payment Received', icon: Banknote, tone: 'green' }`
  (`RotateCcw` imported from `lucide-react`; `'red'` is already a valid
  `FinancialTone`.)
- `FinancialActivityCard.tsx`: when the primary event is a reversal
  (`primary.metadata?.is_reversal`), render the header amount as a **signed,
  negative** value — `−₹8,500` — with the reversal/red tone, instead of
  `Math.abs(...)`. Non-reversal amounts keep the existing `Math.abs` formatting.
  The distinct tag/icon/colour already flow from `getEventDisplay` via the
  existing `tone`/`Icon`/`label` wiring, so no other card change is required.

## Scope / out of scope

- **In scope:** the five items approved — tag text ("Payment Reversed"), colour
  (red/rose tone), icon (undo/`RotateCcw`), summary text, and signed negative
  amount — across the tenant Activity feed and (for consistency) the
  obligation-history timeline that shares the same emitter.
- **Out of scope (flagged, not changed):** the reversal card still shows the
  "Correct Payment" link (`canCorrectPayment = payments.length <= 1` is true for a
  lone reversal row). "Correcting" a reversal would create a
  `PAYMENT_REVERSAL:<reversalRowId>` case — i.e. reverse the reversal. Whether to
  hide "Correct Payment" on reversal cards is a separate behavioural decision, not
  a labelling fix, and is left untouched here. Noted so it isn't lost.

## Testing

- **Backend:** `financial-timeline-service` is exercised against real Postgres
  (`.env.test`, factories). Add/extend a test that reverses a payment and asserts
  the resulting `getTenantTimeline` event has `metadata.is_reversal === true`, a
  negative `amount`, and the "Reversal of ₹… payment" summary; and that a normal
  payment event still has `is_reversal` falsy with the unchanged summary/label
  inputs.
- **Frontend:** no test suite in `frontend-v2`; verification is the build plus a
  manual check that a reversal renders as "Payment Reversed" (red, undo icon,
  −₹8,500) and a normal payment is unchanged.

## Documentation (per CLAUDE.md)

Bug-fix that revealed a display gap → add a `docs/obsidian/Bugs.md` entry and a
`docs/obsidian/Changelog.md` entry; touch `docs/obsidian/Features.md` if the
activity-feed feature description enumerates event tags. No API/schema/business-
rule change (the reversal data model is unchanged; only its presentation).
