# Flexible Payment Links — Design Spec

## Problem

"Share Payment Link" (owner-facing, on the Tenant Profile page and a few other
surfaces) currently fails with `INTERNAL_SERVER_ERROR: No outstanding rent
obligations found for this tenant` whenever a tenant has no `PENDING`/`PARTIAL`
obligation. Even when it succeeds, the generated link is hard-locked to one
obligation's exact outstanding amount — the payer cannot pay more (e.g. to get
ahead on rent) or less (partial payment) than that fixed number.

Goal: any payment link should work regardless of whether the tenant currently
owes anything, and the person opening it should be able to pay whatever amount
they choose — covering current dues, upcoming rent, or paying in advance —
with the payment correctly applied (FIFO across obligations, excess as future
credit), exactly as if the owner had recorded it manually.

## Scope

- Links stay tied to an existing tenant record (payment always allocates
  against that tenant's obligations/ledger). "Anyone" refers to *who can open
  and pay via the link* (tenant, guardian, anyone it's shared with) — that's
  already true today since the pay page is unauthenticated.
- Both **owners** (existing behavior, all current entry points) and **tenants
  themselves** (new — self-service, from their own portal) can generate a
  link for a tenant's account.
- Out of scope: payments from people with no associated tenant record at all
  (e.g. prospective-tenant deposits). Not requested; would need a materially
  different design (no tenant/hostel context to allocate against).

## Current architecture (relevant pieces)

- `payment_link_tokens` (Prisma): `obligation_id` is a required FK. A token
  is created only after `PaymentLinkService.getOrCreateToken`
  (`backend-next/src/services/payments/payment-link-service.ts`) resolves a
  `tenantId` down to exactly one `PENDING`/`PARTIAL` obligation, throwing if
  none exists.
- `GET/POST /api/payments/pay/[token]` (`backend-next/app/api/payments/pay/[token]/route.ts`,
  ~1257 lines) is a single file that both renders the payer-facing HTML page
  and handles the payment actions (`initiate`, `verify`). The amount shown
  and charged is always `linkedObligation.amount − paid`, computed server-side
  from the one locked obligation. There is no frontend route for this in
  `frontend-v2` — the production domain rewrites `/pay/:token` straight to
  this backend route.
- **Two parallel, inconsistent payment-allocation engines already exist:**
  - *Amount-first* (used by the owner's offline "Receive Payment" flow):
    `financialPaymentFacade.receivePayment` /
    `previewSettlement` (`financial-payment-facade.ts`), built on
    `buildSettlementPlan` (`settlement-planner.ts`). Takes a raw rupee amount
    + `tenantId`, FIFO-allocates across all `PAYABLE_STATUSES` obligations
    (`OVERDUE, PENDING, PARTIAL, UPCOMING`), and credits any leftover as
    `FUTURE_RENT_CREDIT_TOPUP` via `tenantFinancialLedgerService`
    automatically (`settlement-engine.ts`).
  - *Obligation-first* (used by the online/Razorpay path today):
    `createMultiObligationPaymentIntent(obligationIds, ...)`
    (`payment-service.ts`). Requires a pre-picked obligation list, assumes
    each obligation's *full* remaining balance is being charged, has no
    concept of a leftover/future-credit remainder.
- Money is paise-precise throughout; obligations remain the audit-first
  source of truth for money owed — this design must not create synthetic
  obligations to represent an arbitrary paid amount.

## Design

### 1. Data model

`payment_link_tokens.obligation_id` becomes **nullable**. It is no longer "the
obligation this link is locked to" — it's an optional hint, set only when a
link is generated from a specific obligation (e.g. an obligation card's
"Share Payment Link"), used solely to pre-fill a *default* amount on the payer
page. No `amount` column is added to the table; the amount charged is always
decided at payment time, not at link-generation time.

Token reuse/caching simplifies: instead of resolving `tenantId` →
"oldest PENDING/PARTIAL obligation" and keying reuse off
`(obligation_id, tenant_id)`, a non-expired token is now looked up/reused by
`(tenant_id, obligation_id-or-null)` directly — no obligation resolution query
needed at generation time at all when no `obligationId` is passed in.

### 2. Link generation — `POST /api/payments/pay-link`

- `PaymentLinkService.getOrCreateToken`: remove the "no outstanding
  obligation" throw. A bare `tenantId` is always sufficient to create a
  token. If `obligationId` is passed, validate it belongs to the resolved
  tenant (existing check) and store it as the hint.
- Authorization gains a tenant-self-service branch: a request authenticated
  as `TENANT` may generate a link, but only for their own `tenant_id` — any
  other `tenantId`/`obligationId` in the body is rejected. Owner behavior
  (any tenant/obligation within their hostel) is unchanged.

### 3. Amount-first online payment intent (the core new backend work)

Today's Razorpay intent path only knows "charge this pre-picked obligation's
full remaining balance." It needs to instead accept a FIFO-computed
allocation:

- When the payer submits an amount, run it through the **same**
  `buildSettlementPlan` engine the offline flow already uses (reused, not
  reimplemented) to compute: which obligations get paid, how much of each
  (may be a partial amount on the last one), and any leftover amount.
- Extend the online intent-creation path to accept that allocation — a list
  of `(obligation_id, amount)` pairs rather than a bare obligation-ID list
  assumed to be "pay in full" — and to lock that same set of obligations
  during intent creation (as the existing flow already locks its one
  obligation) so two concurrent payment attempts can't double-allocate.
- Extend the verification/success path so that once Razorpay confirms
  payment, it executes that same allocation: each obligation gets its
  computed amount applied, and any leftover is credited as future rent
  credit — mirroring exactly what `settlement-engine.executePlanInTx`
  already does for offline-recorded payments. The two payment-recording
  paths (offline, online) converge on the same allocation outcome for the
  first time.
- The server never trusts the client-submitted amount as final — it is
  always re-run through the FIFO planner, under lock, immediately before
  creating the Razorpay order. Same trust model the app already uses
  elsewhere (client amounts are proposals; server derives the charge).

### 4. Payer-facing page (`GET/POST /api/payments/pay/[token]`)

- Default amount pre-fill, in priority order: (a) the hinted obligation's
  remaining balance, if the link carries one; else (b) the tenant's current
  total outstanding, if any; else (c) the tenant's `monthly_rent` (so a
  fully-paid-up tenant can still pay ahead). Always editable.
- A new lightweight `preview` action added to the existing route (same
  file/pattern as the current `initiate`/`verify`/`client_diagnostic`
  actions) wraps the read-only `previewSettlement` call, authorized via the
  token itself (no owner/tenant session needed — the token is the
  capability). The page's existing inline client-side script calls this
  (debounced) as the payer edits the amount, and renders a live breakdown:
  e.g. "₹8,500 → June rent (paid in full)", "₹500 → added as advance
  credit."
- Soft-warning confirmation: if the entered amount exceeds 3× the tenant's
  monthly rent, show a "That's a lot — are you sure?" confirmation before
  "Proceed to Secure Payment" is enabled. Not a hard cap — payer can confirm
  and proceed.
- Amount must be a positive value; reject zero/negative/non-numeric
  client-side and server-side.
- Fully-settled tenant with zero obligations and no linked hint: the entire
  paid amount becomes future rent credit — already a supported outcome via
  the existing ledger topup path, no new state needed.

### 5. Frontend entry points

- Owner side (`PrimaryActionsBar.tsx`, `DocumentsHub.tsx`,
  `TenantCardMoreSheet.tsx` / `useTenantActions.ts`): remove the
  `tenant.outstandingAmount > 0` gate in `useTenantActions.ts` — link
  generation no longer depends on the tenant having dues. Call shape to
  `generatePayLink({ tenantId })` is unchanged.
- `ObligationCard.tsx`: unchanged call shape
  (`generatePayLink({ obligationId })`); the obligation now seeds a default
  amount hint on the resulting flexible page rather than hard-locking it.
- New: a "Share Payment Link" action surfaced in the tenant portal
  (`frontend-v2/src/platforms/tenant`), calling the same API wrapper
  tenant-authenticated. Exact placement within the tenant's existing
  dues/payments UI to be confirmed during implementation planning (portal
  page structure hasn't been surveyed yet in this design pass).

### 6. Documentation updates (per CLAUDE.md rules)

- `docs/obsidian/Business-Rules.md` — new section: flexible payment links,
  amount-first FIFO allocation, future-credit overflow behavior.
- `docs/obsidian/APIs.md` — update `/api/payments/pay-link` (now also
  tenant-callable) and `/api/payments/pay/[token]` (new `preview` action,
  amount now submitted with `initiate`).
- `docs/obsidian/Database.md` — `payment_link_tokens.obligation_id` now
  nullable; note the semantic change (hint, not lock).
- `docs/obsidian/Features.md` — new tenant-portal "Share Payment Link"
  feature entry.
- `docs/obsidian/Changelog.md` — entry for this change.
- `docs/obsidian/Decisions.md` — ADR: payment links may now be used to pay
  ahead of what's currently due, not only to clear existing dues; this is a
  deliberate business-rule change, not a bugfix.

## Rejected alternatives

- **Synthesize a placeholder `rent_obligations` row for the entered
  amount**, then run it through the existing obligation-first path
  unchanged. Rejected: pollutes the obligations ledger with rows that don't
  represent real rent, breaking the "obligations are the audit-first source
  of truth for money owed" invariant, with knock-on effects on every dues
  rollup/report that reads obligations.
- **A separate, parallel "flexible link" type that always books payment as
  future credit**, leaving the existing obligation-locked link untouched.
  Rejected: wrong outcome for the common case — a payer with real current
  dues who uses this link would have their payment misfiled as advance
  credit instead of clearing what they actually owe, rather than FIFO-first
  against real dues with only the remainder as credit.

## Testing

- Backend: unit/integration tests for `buildSettlementPlan`-driven online
  intent creation (partial-per-obligation allocation, multi-obligation
  allocation, full future-credit-only allocation when no obligations exist),
  and for the tenant-self-service authorization branch on
  `POST /api/payments/pay-link` (own tenant only, rejects others).
  `npm run check:financial-safety` and `npm run check:payment-production`
  (existing guard scripts) should be run against the changed payment paths.
- Manual/dev-server verification of the payer-facing page: amount edit →
  live preview updates, soft-warning triggers above 3× rent, successful
  payment for (a) a tenant with existing dues split across two obligations,
  (b) a fully-paid-up tenant paying ahead (pure future credit), (c) an
  obligation-card-originated link's default pre-fill.
