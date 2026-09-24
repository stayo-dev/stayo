# UPI collection, with the payment gateway disconnected

**Date:** 2026-09-23
**Status:** Approved design, not yet implemented
**Supersedes in practice:** the Razorpay checkout path (ADR-172 gateway addendum and related)

---

## 1. Why

Stayo carries a full payment-gateway subsystem — Razorpay checkout, webhooks, payment
attempts, gateway transactions, settlement attribution — that **has never processed a
single rupee in production.**

Verified against `qgfyfbdccjnibdhhvnsr` on 2026-09-22:

| Check | Result |
|---|---|
| `gateway_transactions` rows, all time | **0** |
| `payment_attempts` | 1, with **0** successful |
| `payments` recorded | 40 — **all 40** with `payment_attempt_id IS NULL` |
| Hostels with `upi_id` set | **0 of 6** |

Every rupee that has ever moved through Stayo was paid directly to the owner and recorded
by the owner afterwards. The gateway is not an underused feature; it is an unused one, and
it carries real cost: an internet-facing webhook, a provider integration to maintain, a
merchant relationship, and legal copy that has to describe Stayo as touching tenant money.

The decision is to **stop pretending the gateway is the path** and build the thing owners
and tenants already do — direct UPI — into the product properly.

### What this buys

- **Stayo stops being a payment intermediary.** Money moves owner↔tenant; Stayo records it.
- The internet-facing payment and webhook surface goes away.
- Tenants get a real "how do I pay" answer instead of a dead checkout button.

### What this costs

- **There is no callback.** No webhook, no capture event, no automatic reconciliation.
  Nothing downstream can learn that money moved except by a human asserting it. This is the
  central consequence of the whole design and every section below follows from it.
- Every payment now requires an owner action. At 40 payments that is nothing. At 400/month
  it is real work, and it is the most likely reason owners abandon the feature. See §10.

---

## 2. Scope

**In scope:** disconnecting the gateway; capturing owner UPI IDs; generating UPI QR/intent
links; a tenant-initiated payment claim with UTR and optional screenshot; owner confirmation
that reuses the existing settlement path; provenance tiering; legal-copy correction.

**Explicitly out of scope:** any automatic bank-statement reconciliation, UPI AutoPay /
mandates, refunds, and tenant-to-tenant or deposit flows. None of these are needed to replace
what the gateway was supposed to do, and each is its own project.

**Not deleted:** every Razorpay service, provider and helper file stays on disk, untouched.
This design disconnects the subsystem; it does not remove it.

---

## 3. Decisions taken

These four were decided explicitly during design and are not open:

1. **Owner confirms the claim.** A tenant's claim never marks an obligation paid on its own.
   It creates a pending claim; the owner confirms; only then does money move in the ledger.
2. **Disconnected routes return `410 Gone`.** Handler bodies become one line. Service files
   stay. Re-enabling is one commit per route.
3. **Amount defaults to the obligation the reminder was about, and is editable**, with total
   outstanding shown beneath it. UPI lets the payer change the amount anyway, so the page
   expects a mismatch rather than pretending it cannot happen.
4. **Claim confirmation does NOT require step-up identity confirmation** (see §7.3 for the
   reasoning). `record-offline` keeps its step-up, unchanged.

---

## 4. The constraint that shapes everything: `/pay/{token}`

`apps/frontend/vercel.json` rewrites `/pay/:token` to the **backend**, which serves a
1,266-line self-contained, mobile-optimised, framework-free HTML page
(`app/api/payments/pay/[token]/route.ts`). That is why no React route for it exists.

`lib/services/notifications/whatsapp-reminder-delivery.ts` mints a `payment_link_tokens` row
and puts `{frontendUrl}/pay/{token}` into the **URL button of an approved Meta template** —
the rent reminders that have been live since ADR-196. The rewrite carries `{{1}}` placeholder
variants to absorb Meta sending the raw token.

Therefore:

- **The URL cannot change.** Its base is baked into an approved template; changing it needs
  Meta re-approval.
- **It must not return 410.** Doing so would break the "Pay now" button in every live rent
  reminder already sitting in tenants' WhatsApp.

This is fortunate rather than awkward. The token is already exactly what a UPI page needs:
public (no login), scoped to tenant + obligation + hostel + owner, 7-day expiry, and already
delivered to tenants. **`/pay/{token}` becomes the UPI payment surface.**

This matters because a large share of tenants are `OWNER_MANAGED` and have no app login at
all. Any design that puts payment behind authentication excludes them.

---

## 5. Phase 1 — Disconnect

### 5.1 Routes that return 410

- `app/api/payments/create-intent/route.ts`
- `app/api/payments/verify/route.ts`
- `app/api/payments/test-intent/route.ts`
- `app/api/webhooks/payments/razorpay/route.ts`

Each becomes a one-line handler returning 410 with a stable code (`GATEWAY_DISCONNECTED`).
Imports of provider code are removed from the *route*; the provider files themselves are not
touched.

`app/api/payments/confirm/route.ts` and `app/api/payments/manual-confirm/route.ts` both call
`paymentService.finalizePaymentAttempt`, which is attempt-shaped and only reachable via a
gateway attempt. They are **left in place but become unreachable** once `create-intent` is
410 — no attempt can be created, so nothing can be finalised. They are not modified, because
modifying them risks the manual-confirm path that admins may still need for the single
historical attempt row.

### 5.2 Routes explicitly kept, unchanged

`record-offline`, `offline`, `pending-verification`, `quick-collect`, `dues`, `tenant-dues`,
`obligations`, `preview`, `generate-preview`, `pay-link`, `reconcile`, `settlement-plan`,
`settlement-preview`, `[id]`. These are the real payment path — all 40 production payments
went through it.

### 5.3 Frontend

Remove the gateway checkout entry points from the tenant surfaces that call them
(`features/tenant-financials/components/PaySheet.tsx` and
`platforms/tenant/pages/TenantMoneyPage.tsx`, which calls `paymentService.generatePayLink`).
These become links to the UPI page rather than gateway initiations.

### 5.4 Verification

A test asserting each disconnected route returns 410 and imports no provider module, plus a
source-level guard that no *new* operational code imports
`src/services/payments/providers/razorpay`. This follows the repo's existing
architectural-invariant-check pattern.

---

## 6. Phase 2 — Owner UPI identity

### 6.1 The field already exists

`hostels.upi_id` is in `schema.prisma`, is already returned by `app/api/owner/hostels`,
`app/api/hostels/[id]`, `lib/hostel-context.ts` and
`lib/services/tenant-profile-portal-service.ts`, and already counts toward
`has_payment_setup` in `lib/services/activation-service.ts`.

**Nothing needs to be added to the schema for this.** What is missing is capture: 0 of 6
hostels have it set, so the feature is inert until owners fill it in.

### 6.2 What must be built

- A setup step in owner onboarding / hostel settings that collects and validates the UPI ID.
- **VPA format validation** (`name@handle`) client- and server-side. An invalid VPA produces
  a QR that fails silently in the tenant's UPI app, which is the worst possible failure: the
  tenant believes Stayo is broken.
- A **penny-verification is deliberately NOT built.** It needs a real payment to verify and
  there is no callback to observe it with. Instead the owner sees a live preview of their own
  QR and is asked to scan it themselves once, which is the cheapest honest check available.
- `phonepe_merchant_id` is stale (per `CLAUDE.md`) and is not extended.

### 6.3 Payee name

The `pn=` parameter uses the **hostel name**, not the owner's personal name, so the tenant's
UPI app shows something they recognise. Where a hostel name exceeds what UPI apps display
cleanly it is truncated; the exact limit is a UI detail resolved during implementation.

---

## 7. Phase 3 — The tenant flow

### 7.1 The intent module (pure)

A new pure module builds the UPI URI. No I/O, tested directly — the pattern this repo already
requires for money logic:

```
upi://pay?pa=<vpa>&pn=<hostel>&am=<amount>&cu=INR&tn=<note>
```

Tested for: VPA validation, amount formatting (two decimals, no grouping), note sanitisation
(UPI notes reject many characters), URL encoding, and refusal to build a URI at all when the
VPA is absent or malformed.

QR rendering uses the **existing `qrcode` dependency** (already in `package.json`, already used
by four PDF/agreement modules) via `toString(uri, { type: 'svg' })`, producing inline SVG that
drops into the framework-free page without adding a client-side library.

### 7.2 Device handling

This is where UPI is genuinely awkward and the design must be explicit:

| Context | Behaviour |
|---|---|
| **Android** | `upi://pay?…` intent link. Triggers the real app chooser. Works well. |
| **iOS** | No app chooser exists and `upi://` is not reliably claimed. Render per-app buttons (`gpay://`, `phonepe://`, `paytmmp://`) **plus** the QR. |
| **Desktop** | QR only. `upi://` does nothing. |
| **In-app browser** (WhatsApp, Instagram) | Custom schemes are frequently blocked — and this is the primary entry point. Always render the QR as a fallback, and show an "open in browser" hint. |

The QR is **always rendered**, on every platform. It is the only mechanism that works
everywhere, and it is the fallback whenever a scheme fails to open — which the page cannot
detect.

A tenant cannot scan a QR displayed on the phone they are holding. Same-device needs the
intent link; other-device needs the QR. Both are always present, with the intent link
presented first on mobile.

### 7.3 The claim

After paying, the tenant taps **"I've paid"** and submits:

- **UTR / reference number — required.** This is the primary evidence, because it is what the
  owner can match against their own bank statement. A screenshot cannot be matched against
  anything.
- **Screenshot — optional, supporting.** A screenshot proves nothing: trivially edited, and
  the same image can be submitted repeatedly. It is accepted because owners find it
  reassuring and because it sometimes carries a UTR the tenant mistyped, not because it is
  evidence.
- **Amount actually paid**, defaulting to the amount shown.

This creates a `PENDING` claim and the page switches to "waiting for owner to confirm." The
obligation is untouched.

**Idempotency:** one open (`PENDING`) claim per token. A second submission updates the open
claim rather than creating a duplicate, so a tenant tapping twice does not produce two claims
the owner must reconcile.

---

## 8. Phase 4 — Owner confirmation

### 8.1 Surface

Claims appear in the owner's existing pending-verification surface
(`GET /api/payments/pending-verification` and its dashboard card), extended to include claims
alongside whatever attempt rows exist. The owner sees: tenant, claimed amount, UTR,
screenshot if present, and which obligation the link was for.

### 8.2 Confirm reuses the existing settlement path

On confirm, the handler calls the **same inner settlement logic** that `record-offline` uses —
`paymentService`'s `_settleTenantRentPaymentInTx`, reached through a new
`confirmTenantPaymentClaim` wrapper — rather than writing `payments` rows itself.

This is non-negotiable and follows the rule the financial read model already states: **compose,
never reimplement.** FIFO allocation, receipt generation, the ledger and the audit trail must
have exactly one implementation. A second one will drift, and it will drift in the place where
drift is most expensive.

The claim's `confirmed_at`, `confirmed_by` and resulting payment group id are recorded so the
claim and the payment can always be walked back to each other.

### 8.3 Step-up confirmation: not required (decision)

`recordTenantRentPaymentWithToken` consumes a step-up identity token (`consumeIdentityTokenInTx`).
Claim confirmation deliberately does **not**.

The reasoning: step-up guards *owner-asserted* money movement with no counterparty — the owner
alone claiming a payment happened. A tenant-initiated claim already has a second party, a UTR,
a timestamp and an audit trail, so the risk it mitigates is different in kind. Requiring a
2-minute step-up ceremony per claim would also make the feature unusable at any real volume,
which is already the design's biggest adoption risk (§10).

`record-offline` keeps its step-up, entirely unchanged.

### 8.4 Rejection and reversal

An owner may **reject** a claim (money never arrived, wrong amount, duplicate). The claim moves
to `REJECTED` with a reason; the tenant is notified; the obligation is untouched.

**After confirmation**, reversal is not a claim-level operation. Obligations are audit-first and
immutable by design — there is no obligation-edit endpoint — so an erroneously confirmed payment
is corrected the way every other payment error is: through the existing correction path, not by
mutating the claim. The claim record simply retains its history.

---

## 9. Phase 5 — Provenance, exports and copy

### 9.1 The `verified` tier becomes empty

`ownerPayoutReadModel.rentReceived()` splits rent into `verified` (gateway-captured, carrying a
bank reference a third party can confirm) and `owner_recorded` (cash and direct UPI the owner
typed in). That split exists specifically so a document handed to a lender does not present
self-reported income as third-party-verified.

With no gateway, **`verified` is permanently empty.** Collapsing everything into
`owner_recorded` would be honest but lossy: a payment with a tenant-supplied UTR, confirmed by
the owner, is meaningfully better evidence than a number the owner typed from memory.

**A third tier is introduced:** `tenant_claimed` — tenant-initiated, UTR-carrying,
owner-confirmed. It ranks between the other two. The export's provenance sheet names all three
and states plainly what each one means, so the distinction survives contact with a lender.

The fallback added on 2026-09-22 for the missing `gateway_transactions.tenant_id` column stays;
it is unrelated to this change and still correct.

### 9.2 Legal copy

Published policy copy currently references a payment aggregator. If Stayo never touches tenant
money, Stayo is not a payment intermediary — a simpler and more defensible position, but the
policies must say so accurately rather than by omission. This is a copy change, reviewed
against the six approved legal decisions, and it ships with Phase 1 rather than trailing it.

---

## 10. Risks, stated plainly

1. **Reconciliation burden is the thing most likely to kill this.** Every payment needs an
   owner tap. This is fine at 40 and painful at 400/month. Mitigations available but *not* in
   this scope: bulk confirm, and confirming straight from the WhatsApp command centre. If
   owners complain, that is the direction.
2. **Personal UPI IDs used for collection at scale attract bank scrutiny.** Owners already do
   this manually, so Stayo is not creating the exposure — but Stayo *facilitating* it is a
   different posture, and this needs a view from whoever owns compliance. **This design does
   not resolve that question and should not be read as having resolved it.**
3. **The amount is a suggestion.** For P2P VPA intents most apps let the payer edit it, so
   claimed amount ≠ requested amount will be routine, not exceptional. The claim carries the
   amount actually paid for exactly this reason.
4. **iOS will be worse than Android**, and no amount of care fixes that — it is a platform
   limitation. Expect support questions from iOS tenants specifically.
5. **Screenshots invite false confidence.** Owners may treat a screenshot as proof and confirm
   without checking their bank. The UI should lead with the UTR and present the screenshot as
   secondary, not the reverse.

---

## 11. Data model

One new table, `tenant_payment_claims`:

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `token_id` | FK `payment_link_tokens` — how the claim reaches tenant/obligation/hostel/owner |
| `obligation_id`, `tenant_id`, `hostel_id`, `owner_id` | denormalised for scoped queries and owner-scoped indexes |
| `claimed_amount` | integer paise |
| `utr` | required, indexed for duplicate detection |
| `proof_url` | nullable — ImageKit, matching existing document uploads |
| `state` | `PENDING` / `CONFIRMED` / `REJECTED` (plain string, per repo convention) |
| `rejection_reason` | nullable |
| `confirmed_by`, `confirmed_at`, `payment_group_id` | links the claim to the payment it produced |
| `created_at`, `updated_at` | |

Plus a partial unique index enforcing **one `PENDING` claim per token**.

**A new table, not new columns on `payment_attempts`.** Adding a scalar to an existing Prisma
model makes every read of that table without an explicit `select` demand the column — the exact
mechanism that took hostel listings down on 2026-08-22 when `navigation` shipped ahead of
migration 074. A new table has no such blast radius. It also keeps a tenant-initiated claim
structurally distinct from a gateway attempt, which it is.

This table **is** declared in `schema.prisma` (unlike migration 075's columns) because nothing
reads `tenant_payment_claims` without selecting from it explicitly, and it is new — there is no
existing unselected read to break.

---

## 12. Testing

Constrained by environment: the backend's main suite needs a database, and the frontend suite is
node-only with no DOM. Both are worked with, not against.

- **Pure, in `vitest.pure.config.ts`:** UPI URI construction and VPA validation; the claim state
  machine (`PENDING`→`CONFIRMED`/`REJECTED`, and every illegal transition); amount and note
  formatting; device→render-strategy selection.
- **Mocked-DB, pure suite:** claim creation idempotency; that confirmation calls the shared
  settlement function rather than writing payments directly (asserted by mock, so a future
  reimplementation fails the test).
- **Source-level guards:** disconnected routes return 410 and import no provider; no new
  operational import of the Razorpay provider.
- **Not covered, and stated as such:** nothing here exercises a real UPI app, a real bank, or a
  real device. The device matrix in §7.2 is the highest-risk untested surface and needs manual
  checking on at least one Android phone, one iPhone, and inside the WhatsApp in-app browser
  before this reaches owners.

---

## 13. Phasing

Each phase is independently shippable and independently valuable.

| Phase | Content | Ships value alone? |
|---|---|---|
| 1 | Disconnect + 410s + frontend unlink + legal copy | Yes — removes live attack surface immediately |
| 2 | UPI capture, validation, QR preview in settings | Yes — owners can at least show tenants a QR |
| 3 | `/pay/{token}` becomes the UPI page + claim submission | Yes — tenants can pay and claim |
| 4 | Owner confirmation + settlement reuse | Completes the loop |
| 5 | Provenance tier + export copy | Yes — restores lender-grade accuracy |

**Phase 1 and Phase 2 have no dependency on each other** and can be done in either order.
Phases 3 and 4 must ship together or tenants file claims nobody can confirm.

---

## 14. Open questions

Deliberately unresolved, and each needs a human rather than an implementer:

1. **Compliance posture on personal UPI collection at scale** (§10.2). Needs a decision from
   whoever owns compliance before this is promoted widely.
2. **Whether a hostel's UPI ID may differ from the owner's payout account.** The schema allows
   per-hostel UPI IDs; whether that is desirable, or an invitation to misdirected rent, is a
   product call not made here.

---

## 15. Documentation this will require

Per the repo's documentation rule, implementing this updates, in the same change:

- `docs/obsidian/Decisions.md` — **an ADR is required.** Disconnecting a payment provider and
  replacing it with a trust-based flow is a deliberate architectural choice, not a bugfix.
- `docs/obsidian/APIs.md` — four routes become 410; `/pay/{token}` changes behaviour; claim
  endpoints are added.
- `docs/obsidian/Database.md` — the `tenant_payment_claims` table and its migration.
- `docs/obsidian/Business-Rules.md` — "a tenant's claim never marks an obligation paid"; the
  three provenance tiers.
- `docs/obsidian/Features.md` and `docs/obsidian/Changelog.md` — per phase.

`docs/business-logic/` also carries the financial-consistency investigation report, which
describes the gateway path as live; it needs a correction note.
