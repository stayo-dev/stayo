# Settle at Invite — Plan

**Goal:** An owner records what a tenant has already paid *while inviting them*, sees exactly how it will be allocated, and sends the invitation with the books already true.

**Two situations, one mechanism:**
1. Deposit negotiated and paid face-to-face, cash or UPI, at the moment of joining.
2. Onboarding a hostel that has been running for months — a tenant five months in who has already paid five months of rent plus deposit.

## What the audit found (do not rebuild any of this)

- `onboardingFinancialsService.initializeOnboardingFinancials` already runs **inside `createInvitation`** and creates `SECURITY_DEPOSIT`, `MAINTENANCE` and the first `RENT` obligation. Obligations therefore exist while the tenancy is still `INVITED`.
- `buildSettlementPlan(snapshots, amount, policy, allowed)` is **pure** — plain data in, plan out. A preview needs no database rows.
- `financialPaymentFacade.receivePayment(tx, data, groupId)` records a payment with FIFO allocation, ledger and receipt.
- `agreementRentScheduleService.generateForAgreementInTx` generates a full multi-month schedule from `agreement_start_date`, past months included — but requires an `Agreement`, which only activation and renewal create.
- The invite wizard already collects `agreement_start_date`, `agreement_duration_months`, rent, deposit and maintenance.

## The gap

`rent-generation-service` only ever generates the **current** month (`rentMonth` is hardcoded to today's month). Adoption generates no schedule at all. So a tenancy backdated five months produces one rent obligation, not five — the mid-year case cannot work today.

## Decisions taken

- Entering an amount **adopts the tenancy immediately** (owner-managed). The books are true from that moment, the invitation still goes out, and the tenant can claim the same record later.
- Wizard only. No bulk-import work in this plan.

---

### Task 1: The preview — pure, no database

**Files:** `apps/backend/lib/billing/invite-settlement-preview.ts` + `apps/backend/tests/invite-settlement-preview.test.ts` (register in `vitest.pure.config.ts`).

`buildInviteSettlementPreview(input)` where input is `{ monthlyRent, securityDeposit, maintenanceCharge, maintenanceType, agreementStartDate, durationMonths, dueDay, amountPaid, amountIncludesDeposit, today }`.

It synthesises the obligation snapshots that *would* exist — deposit, maintenance, and one RENT per elapsed month from `agreementStartDate` through `today` — then runs the existing `buildSettlementPlan` over them. Reuse `agreement-rent-schedule-service`'s month helpers (`firstOfUtcMonth`, `addUtcMonths`, `dueDateForMonth`) rather than writing new date maths; a preview that disagrees with what actually gets created is worse than no preview.

`amountIncludesDeposit = false` must exclude the deposit snapshot from the allocation set, so the money goes to rent only.

Return the per-obligation allocation, the total allocated, and what remains outstanding.

Tests: five elapsed months allocate oldest-first; a partial amount leaves a named month short; deposit-excluded routes nothing to the deposit; an amount larger than everything owed reports the excess; a start date in the current month behaves like an ordinary new tenancy.

### Task 2: Backdated rent at invite

**File:** `apps/backend/src/services/payments/onboarding-financials-service.ts`

It creates one RENT obligation for the joining month. Extend it to create one per elapsed month when `joiningDate` is in the past, using the same row shape, the same duplicate guard, and the same due-date rule. Cap the backfill at a sane horizon and refuse a start date before the hostel existed.

This is what makes the mid-year case real. Without it the preview promises months the system never creates.

### Task 3: Settle during invite creation

**File:** `apps/backend/src/services/tenants/tenant-invitation-lifecycle-service.ts` (`createInvitation`), plus its validator and route.

Accept `paid_amount`, `paid_includes_deposit`, `payment_method`, `payment_reference`. When `paid_amount > 0`, inside the existing transaction and after the obligations are created:
1. Adopt the tenancy (owner-managed) — reuse `ownerManagedTenancyService`'s logic; do not duplicate it.
2. `financialPaymentFacade.receivePayment` for the amount, with `offlineRecordedBy` set to the owner and an idempotency key derived from the invitation, so a double submit cannot record twice.

`payment_method` is required whenever `paid_amount > 0`. Refuse an amount larger than what is owed, naming the figure.

### Task 4: The wizard

**Files:** the Money step and Verify step of `InviteTenantWizard`, plus a pure module for the decision logic.

Money step gains: **"Has the tenant already paid anything?"** → amount, a toggle for whether it includes the security deposit, and a payment-method picker (reuse `PAYMENT_MODES`).

Verify step shows the **preview**, concretely:

> ₹40,000 received → Deposit ₹16,000 · Aug ₹8,000 · Sep ₹8,000 · Oct ₹8,000 → Nov onwards outstanding

Say plainly, where the owner can see it, that recording a payment means they will be managing this tenant's records, and that the tenant can still join the app later and pick up the same record.

Branch logic pure and tested; components stay renderers. No `.test.tsx`.

## Verification

Backend: `npx tsc --noEmit` (baseline 529), `npm run check:invariants` (baseline 2 FAILs), `npm run test:pure` (baseline 1116 passed / 2 failed).
Frontend: `npx vitest run` (baseline 1700), `npm run check:architecture`, `npm run build`.
