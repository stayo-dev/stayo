---
tags: [backend]
---

# Backend — `apps/backend/`

Related: [[Architecture]] · [[APIs]] · [[Database]] · [[Business-Rules]]

Canonical API: Next.js 14 App Router + Prisma + Postgres (Supabase). This page reflects a direct read of the service layer (`lib/services/`, `src/services/`, `src/repositories/`) — ~140 service files across both trees, plus 7 repository files. Not every file gets a line here; this covers structure, domain placement, and things worth knowing before touching this code.

## Structure

| Path | Role |
|---|---|
| `app/api/` | Route handlers — kept thin. 294 route files. See [[APIs]]. |
| `lib/services/` | ~66 files. See "domain placement" below — not simply "legacy." |
| `src/services/` | ~73 files across `payments/`, `tenants/`, `change-management/`, `admissions/`, `rooms/`. |
| `src/repositories/` | 7 files — **partial**, not universal, indirection (see below). |
| `prisma/schema.prisma` | Source of truth for models/enums — see [[Database]]. |
| `lib/billing/engine.ts` | Pure late-fee math (flat/per-day/percentage, grace days, cap) — see [[Business-Rules]]. |
| `lib/auth*` | JWT + httpOnly refresh-cookie auth; `lib/auth-edge.ts` is the edge-safe variant used by `middleware.ts`. |

## Domain placement: `lib/services/` vs `src/services/`

**Confirmed by cross-import check that both trees are genuinely live and mutually dependent** (11 `lib/` files import from `src/`, 17 `src/` files import from `lib/`) — this is not a legacy-vs-canonical split, it's a domain split:

| Domain | Lives in |
|---|---|
| Payments/obligations execution (obligation lifecycle, settlement, ledger, receipts, reminders, rent generation) | `src/services/payments/` — `payment-service.ts` (3835 lines, the payment-flow orchestrator), `obligation-engine.ts`, `financial-service.ts`, `financial-read-model-service.ts`, `financial-timeline-service.ts`, `tenant-financial-ledger-service.ts`, `settlement-engine.ts`/`settlement-planner.ts`, `rent-generation-service.ts`, `reminder-service.ts` |
| Billing *configuration*/rules-math | `lib/billing/engine.ts` (late-fee math), `lib/services/hostel-billing-preferences-service.ts`, `hostel-policy-service.ts`, `billing-schedule-service.ts`, `billing-timeline-service.ts`, `billing-transition-service.ts`, `billing-validation.ts` — payments *execution* is in `src`, billing *config/math* is in `lib`, and they actively import each other |
| Tenants (onboarding, activation, agreements, renewal, transfer) | `src/services/tenants/` — `tenant-service.ts` (1577 lines), `tenant-onboarding-service.ts`, `activation-workflow-service.ts`, 8 `agreement-*-service.ts` files, `invitation-service.ts`, `tenant-invitation-lifecycle-service.ts` (1242 lines), `tenant-transfer-service.ts`, `renewal-*-service.ts`. Renewal eligibility/activation validation is centralized in `renewal-readiness-engine.ts` (pure check functions + `evaluateActivationReadiness`/`evaluateCreationReadiness` orchestrators) and `renewal-activation-engine.ts` (`activateRenewal()` — locking, predecessor/successor status transitions, tenant-contract sync, rent-schedule generation), shared by cron activation, manual signing, and manual draft creation rather than each hand-rolling its own copy — see [[Decisions]] ADR-015. Every renewal write path also registers a `RenewalTimelineEvent` via `renewal-timeline-service.ts`, inside the same transaction as the mutation it describes — see [[Decisions]] ADR-016, [[Database]]. `renewal-workspace-read-model.ts` composes the readiness engine, timeline service, and `financial-read-model-service.ts` (below) into one per-agreement bundle for the Individual Renewal Workspace UI — see [[Decisions]] ADR-018, [[APIs]]. `agreement-renewal-signing-service.ts`'s `signRenewalAgreement` already accepted a tenant session; `app/api/tenants/me/renewal-signature/route.ts` (new, 2026-07-22) is the session-authenticated signature upload it needed — see [[Decisions]] ADR-019. `renewal-offer-service.ts::generateBulkOffers` supports 5 bulk pricing strategies (`FLAT`/`PERCENTAGE`/`ROOM_CATEGORY`/`FLOOR_WISE`/`ROOM_WISE`) — all are plain-string values on `bulk_renewal_batch.renewal_strategy`, not a Prisma enum. |
| Tenant analytics/migration/self-service portal | `lib/services/` — `tenant-analytics-service.ts`, `tenant-migration-service.ts` (bulk import), `tenant-profile-portal-service.ts` |
| Hostels/properties/portfolio/dashboards | `lib/services/` — `property-service.ts` (931 lines), `hostel-policy-service.ts`, `room-capacity-service.ts`, `portfolio-service.ts`, `portfolio-performance-service.ts`, `dashboard-service.ts` (1659 lines) |
| Room *allocation* | `src/services/rooms/room-allocation-service.ts` |
| Auth | `lib/services/` entirely — `auth-service.ts` (741 lines), `auth/auth-otp-service.ts`, `session-lifecycle-service.ts`, `rate-limit-service.ts`, `user-service.ts` |
| Notifications (WhatsApp, email, briefings) | `lib/services/notifications/` entirely — see WhatsApp section below |
| Change management (tenant-edit approval workflow) | `src/services/change-management/` — self-contained: `change-management-facade.ts`, `change-request-service.ts`, `approval-engine.ts`, `change-policies.ts`, `diff-engine.ts`, `domain-events.ts`, `entity-adapter.ts`, `field-classification.ts`, `simulation-engine.ts`, `validation-engine.ts` |
| Admissions (leads pipeline) | `src/services/admissions/admissions-service.ts` (1388 lines) |
| Owner-acquisition funnel (platform leads → activation) | `src/services/platform-leads/lead-invitation-service.ts` (added 2026-07-29, ADR-032) — token generation/expiry/single-use, WhatsApp+email dispatch, and the 3 auto-progression choke points, deliberately not sharing code with `tenant-invitation-lifecycle-service.ts` above despite the near-identical shape (a lead has no `tenant_id`/`hostel_id`/`room_id` yet) |
| Financial invariants/reconciliation/integrity | `lib/services/` — `financial-invariant-service.ts`, `financial-reconciliation-service.ts`, `hostel-invariant-validator.ts`, `owner-isolation-invariant-service.ts`, `hostel-integrity-dashboard.ts`, `migration-audit-service.ts` |

## `lib/billing/engine.ts` — the late-fee math primitive

Header comment literally states this is "THE canonical implementation of all billing math," pure functions only. `calculateLateFees()` computes a full cumulative multi-day preview (flat/percentage/per-day rules, stacked, grace-days-adjusted, cap-enforced). **Only imported in one production file**: `src/services/payments/reminder-service.ts`. `calculateLateFees` itself has zero production callers found (only its own test) — the cron actually uses `resolveRules()`/`calculateSingleRuleFee()` (single-rule-per-day) and accumulates day by day itself. See [[Business-Rules]] for the full mechanics.

## `src/repositories/` — a partial abstraction, not a full pattern

7 files: `tenantRepository.ts`, `allocationRepository.ts`, `roomRepository.ts`, `paymentRepository.ts`, `invoiceRepository.ts`, `changeRequestRepository.ts`, `billingRepository.ts`. Most are near-1:1 passthroughs to `prisma.<model>.*`. **Most services call `prisma` directly rather than going through these** — the repository layer exists mainly to centralize a couple of complex hand-written aggregate queries (`billingRepository`'s operational-cashflow/dues/defaulter queries backing `financial-service.ts`) and provide a shared `transaction()` helper, not to enforce a universal data-access boundary.

## Notification services (`lib/services/notifications/`)

Two structurally separate WhatsApp systems:
- **`owner-whatsapp-assistant.ts`** (7180 lines — the largest file in the entire services tree) — owner-facing conversational assistant, ID-based interactive menus rather than flat keyword commands.
- **`whatsapp-webhook-event-service.ts`** — tenant-facing entry point. Flat text-command router (`BAL`/`BALANCE`, `SWITCH`, `DUES`, `PAY`, `STATUS`, `HELP`) plus interactive button-reply handling. See [[Business-Rules]] for the exact command table. Also owns webhook persistence/idempotency: `recordReceived()` (hash of the raw body, `ON CONFLICT DO NOTHING`) and `claimForProcessing()` (atomic claim — one delivery wins, stale `PROCESSING` reclaimable after 10 min).

Both are reached through **one** webhook handler, `whatsapp-webhook-handler.ts` — signature verification, the GET challenge, and acknowledge-then-process live there, and the two route files (`/api/webhooks/whatsapp` canonical, `/api/webhooks/notifications/whatsapp` legacy) only delegate to it. Don't add a third entry point; see [[Decisions#ADR-037|ADR-037]] and [[APIs#Notifications & WhatsApp|APIs]].

Plus: `briefing-engine.ts` (owner daily briefing cards), `whatsapp-reminder-delivery.ts`, `whatsapp-billing-intelligence.ts`, `whatsapp-selection-state.ts` (conversational state machine, Redis-backed), `whatsapp-resident-context.ts` (tracks which tenant a phone number is "acting as" in a shared household), `providers/whatsapp/meta-provider.ts` (the actual Meta Cloud API client).

## Commands

```bash
cd apps/backend
npm install
npm run prisma:generate      # regenerate Prisma client after schema.prisma changes
npm run dev                  # :3000
npm run build
npm run lint
npm test                     # vitest, tests/**/*.test.ts
npx vitest run tests/<file>.test.ts
npx vitest run tests/<file>.test.ts -t "case name"
```

Env vars load from `../.env` (repo root) via `DOTENV_CONFIG_PATH=../.env`. `.env.test` is used by the test suite. Vitest runs with `fileParallelism: false` — tests share a real Postgres connection, not safe to parallelize.

**Important test-coverage gap, confirmed in code**: `vitest.config.ts` explicitly excludes `lib/**/*.test.ts` from the `npm test` run (`include: ['tests/**/*.test.ts']`). This means every `*.test.ts` file living inside `apps/backend/lib/services/` and `lib/billing/engine.test.ts` (12+ files) **is never actually executed** by CI/`npm test`. One of them (`lib/services/rent-generation-service.test.ts`) imports a relative path that doesn't even exist anymore (the real file moved to `src/services/payments/rent-generation-service.ts`) — this would fail if the test ever ran, but it silently never does. Real, executed coverage for these domains lives under `apps/backend/tests/` (80 files). **Do not cite a `lib/services/*.test.ts` file as evidence of test coverage.**

## Safety checks (run before touching payment/obligation code)

```bash
npm run check:invariants
npm run check:activation-invariants
npm run check:financial-safety
npm run check:payment-production
```

`apps/backend/scripts/architectural-invariants-check.ts` is a static regex-based file scanner enforcing 9 rules, most notably: `hostelId` must never be optional in operational service/route signatures; no "first hostel" (`hostels[0]`) fallback pattern; no `$queryRawUnsafe` outside an allowlist of invariant/audit tooling; **settled `payments` rows must never be updated/upserted/deleted by application code anywhere**; payment-attempt status transitions must go through the one blessed helper (`payment-service.ts`/`payment-status-event-service.ts`); `portfolio-service.ts` must not query raw transactional tables without a hostel-scoping proximity check; frontend `useQuery` hooks must include `hostelId` in their query key (with 6 named exceptions).

## Auth/session model

**Supabase Auth is the sole session/identity provider (ADR-031, `docs/obsidian/Decisions.md`).** The previous custom JWT+refresh-token system (dead `SessionLifecycleService.rotateRefreshToken()`, the raw-OAuth2 `googleLogin()`) is gone.

- Access token: a real Supabase-issued JWT (ES256), verified in `middleware.ts` via `lib/auth/supabase-jwt-edge.ts`'s `verifySupabaseAccessToken()` against Supabase's JWKS endpoint (`createRemoteJWKSet` — local verification, no per-request network call, no shared secret).
- `getSession()` moved from `lib/auth-edge.ts` (Edge-only, can't use Prisma) to `lib/auth.ts` (Node), since Supabase-mode resolution needs a DB lookup. It's dual-mode: `x-auth-mode: legacy` reads the old header shape directly (no DB — a transition-window fallback for pre-migration tokens, which age out after 12h); `x-auth-mode: supabase` calls `lib/auth/supabase-session.ts`'s `resolveSupabaseSession()`, which resolves `profiles` by `auth_user_id` (falling back to email-match + the same Google/tenant/`email_verified` rules `googleLogin()` used to enforce) and returns the *same* `AuthPayload` shape every route already expects — **all 243+ `getSession()` call sites are unchanged**.
- `profiles.auth_user_id` (nullable, unique) + `auth_linked_at` link a profile to `auth.users`. Linking is just-in-time (`lib/auth/supabase-identity.ts`'s `ensureSupabaseIdentity()`), on every successful password login — not a backfill/forced reset. `npm run reconcile:supabase-identities` (dry-run by default, `--apply` to write) reports/repairs linkage state by cross-referencing `profiles` against `auth.users` by both `id` and `email`.
- Idle timeout 30 min (Redis, `lib/redis/session-revocation-edge.ts`'s `checkIdleTimeoutEdge()`, checked in `middleware.ts` for Supabase-mode requests — legacy-mode idle-checking is unchanged, still `sessionLifecycleService.touchSession()` in `/api/auth/me`/`/api/auth/activity`). Absolute session cap 30 days for both owner and tenant, configured in the Supabase dashboard, not app code.
- Immediate revocation (logout, password reset) still goes through the pre-existing Redis deny-list (`checkSessionRevocationEdge`) — Supabase's own access tokens are stateless and can't be revoked instantly on their own, so `/api/auth/logout`/`logout-all` additionally call `supabase.auth.admin.signOut()` to kill the refresh token server-side too.
- `password_hash` on `profiles` is kept permanently — required by the (unrelated, unchanged) `identity_tokens` step-up-confirmation flow and phone-OTP/onboarding-tenant login, neither of which move to Supabase.
- `JWT_SECRET`/`jose` remain for SSE short-lived tokens, receipt-verification tokens, `identity_tokens`, and password-reset tokens — all app-minted/app-verified, unrelated to the login session.
- Managed by `lib/services/auth-service.ts` (`createSessionAndTokens()` is still the one chokepoint every login path funnels through — it now provisions/links Supabase identity and calls `signInWithSupabasePassword()` instead of minting a custom JWT) and the trimmed `lib/services/session-lifecycle-service.ts` (now just the policy constants — `ACCESS_TOKEN_MAX_AGE_SECONDS`, `TENANT_REFRESH_DAYS`, `OWNER_ABSOLUTE_MS`, `INACTIVITY_TIMEOUT_MS`, `getSessionCookieOptions` — plus `touchSession`/`revokeSession`).

## Things worth flagging before you rely on them

- **Two files named `activity-service.ts` and `activity.service.ts`** in `lib/services/` both export a class called `ActivityService` with overlapping but not identical shape — looks like an accidental duplicate. Which is canonical is **Unknown / needs clarification**; check import counts before assuming either is dead.
- **`lib/services/settlement-preview-service.ts` is not move-out settlement** — its only method, `buildFrequencyChangePreview()`, is for billing-*frequency-change* previews. Actual move-out settlement math lives inline in `lib/services/move-out-service.ts`. Easy to conflate given the filename.
- `FinancialService`'s doc-comment says operational dues exclude "LEFT" tenants, but the `TenantStatus` enum has no `LEFT` value (only `FORMER_TENANT`) — likely stale wording from a prior enum name.

## See also
- [[APIs]] for the endpoint-level detail these services back
- [[Database]] for schema/migrations
- [[Business-Rules]] for the domain rules these services enforce
- [[Frontend]] for the client side of this API
