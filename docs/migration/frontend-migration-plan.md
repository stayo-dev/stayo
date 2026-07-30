# StayO Frontend Migration Plan

Version: 2.0 — rewritten from live code inspection
Status: Active
Last Updated: July 2026
Supersedes: v1.0 of this document, which was written from assumptions before the codebase was inspected (see "What changed from v1.0" below).

---

# Purpose

This document evaluates the **actual** legacy Shri Adithya frontend (`apps/frontend/`, Vite + React 19 SPA — not "React" generically, and definitely not talking to a FastAPI backend) for architectural reuse in StayO. Per instruction, this is an **architecture and business-logic** evaluation only — UI design and branding are explicitly out of scope and are being replaced wholesale (see `legacy/shri-adithya-frontend-reference.md` for the UI/screen inventory, and the earlier StayO scope memo establishing that the legacy UI is reference-only, never the target design).

No code was modified to produce this document.

---

# What changed from v1.0

The previous version was a generic template, not a finding. Three corrections that materially change the migration approach:

1. **The backend is not FastAPI.** v1.0's "Current Architecture" diagram said `Frontend → REST API → FastAPI Backend → Supabase`. The real backend is Next.js 14 App Router + Prisma (see `docs/migration/backend-gap-analysis.md`), reused from the same document that already corrected this for the backend side — this frontend doc simply hadn't been fixed to match.
2. **"Reuse: Complaints, Food" is impossible** — v1.0 listed these as backend capabilities the frontend should integrate against. Per the backend gap analysis, neither exists server-side. Confirmed from the frontend side too: `features/tenants/components/profile/ComplaintsSection.tsx` contains a code comment stating outright *"Complaint tracking is not yet available via API"*, and zero food-related code exists anywhere in the frontend.
3. **The migration plan assumed a clean, well-abstracted legacy frontend that just needs a new design skin.** The reality, found by direct inspection, is closer to: **one genuinely solid layer (the API client) and one genuinely solid feature module (tenants), surrounded by three redundant, mostly-dead indirection layers, inconsistent state patterns, and business logic that leaked into the UI in a few specific, findable places.** This document replaces "swap the design system" with a concrete per-layer reuse decision.

---

# Method

Four areas were inspected directly (route handlers, service files, hooks, and cross-referenced against the verified backend endpoint list from `docs/migration/api-reuse-checklist.md`): the API integration layer and state management; forms, validation, and utilities; dead code, duplicate components, and broken navigation; and a full call-by-call audit of every frontend API call against the real backend. Findings below are load-bearing on that inspection, not inferred from folder names.

---

# Architecture Overview (verified)

| | |
|---|---|
| Framework | Vite + React 19 SPA (`apps/frontend/`) |
| Routing | React Router, split into `PublicRoutes`/`OwnerRoutes`/`TenantRoutes`/`AdminRoutes` (the last is an empty stub — see `legacy/shri-adithya-frontend-reference.md`) |
| HTTP client | axios, wrapped in one hand-built client (`lib/api-client.ts`) — **not** a generated SDK, **not** fetch |
| Server-cache state | React Query (`@tanstack/react-query`), centralized `QueryClient` in `lib/queryClient.ts` |
| Client state | Overwhelmingly local `useState`; one `Context` (auth); **exactly one** Zustand store in the entire app |
| Forms | No shared abstraction — every modal hand-rolls `useState` per field |
| Validation | No client-side schema validation library in use (Zod is a backend-only dependency) |
| Type safety | Every feature's API layer (`features/*/api/index.js`, 14 files) is plain JavaScript, not TypeScript, despite the rest of the app being TS/TSX — `allowJs: true` is set specifically to accommodate this |

---

# Layer-by-layer classification

## API Integration Layer

**`lib/api-client.ts`** — **✅ Reuse as-is.** This is the single best-engineered file in the frontend. Axios-based, in-memory access token (not localStorage — correct practice), httpOnly refresh cookie, automatic CSRF bootstrap with request dedup, a real 401-refresh-and-retry interceptor that avoids recursion by using a raw axios call for the refresh itself, and a clean event-based decoupling pattern (`window.dispatchEvent('hms:session-expired', ...)`) that lets `AuthContext` react without the client needing to know about React state. `requestWithRetry` (linear-backoff retry on network/5xx errors) exists and works, though it's currently used in exactly one place (`features/dashboard/api/index.js`).

One fix required before StayO cutover: the production base-URL fallback is **hardcoded to the old brand** (`https://api.sriadithyahostels.in/api`), used whenever `VITE_API_URL` is unset. This must become a StayO domain or fail loudly instead of silently falling back to a dead legacy host.

**Redundant indirection layers — ❌ Delete, do not carry forward:**
- `infrastructure/api/client.ts`, `infrastructure/query/client.ts` — one-line re-export shims over `lib/api-client.ts`/`lib/queryClient.ts`. Exactly **one file** in the entire app imports through them (`domains/payments/api/verify.ts`). Everything else imports `lib/api-client.ts` directly. The indirection was never adopted.
- `services/index.ts` — a barrel re-exporting ~17 feature services. **Zero consumers anywhere in `src`.** Also has a live footgun: `tsconfig.json` declares a `@services/*` path alias but `vite.config.ts`'s alias block has no matching entry — code written against it would type-check and then fail to build. Delete outright.
- `domains/*/index.ts` (the outer barrel per domain — `domains/payments/index.ts`, `domains/tenants/index.ts`, etc.) — **zero consumers.** Delete.
- `domains/*/api/index.ts` (the inner layer) is a **partial exception** — 4 of these (`payments`, `tenants`, `rooms`, `hostels`) are actually imported by 3 real pages (`ReceiptVerificationPage.tsx`, `AddTenantModal.tsx`, `EditInviteModal.tsx`). If reused, collapse this indirection too (those 3 files should import `features/*/api` directly, same as everywhere else) — but note it before deleting, since it isn't purely dead like the rest.
- Net effect: **4 layers of indirection exist for "call the backend," 3 of which do nothing.** The StayO frontend should have exactly one: `features/*/api/*` calling `lib/api-client.ts` directly, which is already the dominant real pattern.

**Per-feature API modules (`features/*/api/index.{js,ts}`, 17 folders)**: **✅ Reuse as-is, with two fixes.** All correctly go through `lib/api-client.ts` — a full-tree grep confirmed zero raw `fetch()`/`axios` usage outside the sanctioned client anywhere in `app/`, `platforms/`, `shared/ui/`, `features/`, `portal/`, `context/` (the architectural-invariant script's claim is genuinely true, not just asserted). Required fixes before reuse:
1. **Convert to TypeScript.** These 14 JS files are the entire application's API contract layer and currently have zero compile-time type checking.
2. **Fix the confirmed broken/stale calls** (found by direct cross-check against the verified backend endpoint list — see the companion doc `docs/migration/page-mapping.md` for the full table): calls to two now-decommissioned routes (`/owner/logo`, `/owner/me/activation`), and several calls to paths that don't exist on the backend at all (`/allocations/owner-history`, `/profiles/complete`, `/payments/initiate`, `/payments/submit-reference`, `/payments/export`, `/payments/bulk-generate`, `/activity/list`, `/activity`, `/admissions/leads/analytics` — the last is almost certainly a typo for the real `/leads/analytics`). None of these are exercised by v1.0's classification, because v1.0 never checked.

## State Management

**React Query usage — ✅ Reuse as-is.** `queryClient.ts` has sane centralized defaults. `queryKeys.ts` is a well-designed centralized key factory (owner-scoped and hostel-scoped helpers, with a sentinel key to avoid collisions on disabled queries) — this is the pattern to keep.

**Query-key adoption — 🔄 Refactor.** The good factory above is inconsistently used. Two features (`tenant-portal`, `change-management`) built their own competing local key factories instead of extending the shared one, and the legacy `app/components/**`/`portal/**` view layer mostly ignores it entirely — 60+ raw inline array-literal keys were found scattered across large view components. This fragmentation makes cache invalidation fragile (prefix-based invalidation calls rely on a consistency that doesn't actually exist). Consolidate onto one factory during the rewrite.

**`context/AuthContext.tsx` — 🔄 Refactor (split responsibilities).** The auth logic itself — session state, the 401/refresh event listener, login/logout — is solid and non-trivial to rebuild from scratch. But the same provider also owns a full idle-timeout system (25-minute warning, 30-minute auto-logout, activity-ping scheduling, its own modal UI), localStorage persistence, and React Query cache lifecycle management. Recommend splitting the idle-timeout concern into its own hook, keeping the rest.

**`features/tenants/store/tenantStore.ts` (Zustand) — ✅ Reuse as-is, but note it's precedent-setting, not precedent-following.** This is the *only* Zustand usage anywhere in the app — a small, well-scoped store for tenant-list filter/UI state. Reusing it is fine; treat "should StayO use Zustand more broadly" as a fresh architectural decision, not a continuation of an established pattern (there isn't one yet).

## Hooks

**✅ Reuse as-is** where they exist: `features/tenants/hooks/*` (2 files), `features/tenant-portal/hooks/*` (2 files, including a nice progressive-loading pattern in `useTenantDashboard` — critical data loads first, 11 secondary queries gated behind a short delay), `features/change-management/hooks/useChangeRequests.ts`, `features/owner-actions/hooks/useOwnerActions.ts`. These are genuinely good examples of "hook wraps the API layer, component stays thin."

**🔄 Refactor — inconsistent adoption.** Only 4 of 17 features have a `hooks/` folder at all. The other 13 features' components call their `api/index.js` services directly inline via raw `useQuery`/`useMutation`. Several legacy view components (`AlertsView.tsx`, `RenewalQueueView.tsx`, `AgreementLifecycleRecoveryView.tsx`, `FinancialControlCenter.tsx`, `TenantsPortfolioView.tsx`) act as large page-level orchestrators managing many independent queries and local state inline — good decomposition candidates, following the pattern the 4 done-right features already establish.

`shared/hooks/` is empty (`.gitkeep` only) — an aspirational folder with nothing in it.

## Forms & Validation

**❌ Rewrite — no reusable pattern exists.** `react-hook-form` is a listed dependency and `app/components/ui/form.tsx` is a full shadcn RHF binding set — but **zero real feature components use either.** Every form-bearing modal audited (`AddTenantModal.tsx`, `RecordPaymentModal.tsx`, `AddHostelModal.tsx`) hand-rolls its own `useState`-per-field state, manual `preventDefault()` submission, and plain HTML `required` attributes instead of schema validation. There is no shared form-field component set actually in use. `zod` is entirely absent from the frontend's dependencies. This means there is no existing frontend form architecture to preserve — the StayO rebuild needs to introduce one (RHF+Zod or otherwise) fresh, and can delete the unused shadcn `form.tsx` scaffold and the dead `react-hook-form` dependency if a different approach is chosen.

One useful discovery while auditing forms: `InviteTenantModalV2.tsx` is not a second implementation — it's a 2-line re-export alias of `AddTenantModal.tsx`. Only one real invite-modal implementation exists despite two file names suggesting otherwise.

## Business logic that leaked into the frontend — 🔄 Refactor (fix before reuse, not a blocker to ship around)

CLAUDE.md and the backend gap analysis both establish the backend as the sole source of truth for financial calculations. Direct inspection found concrete violations of that principle, all fixable without a rewrite:

- **Overdue-day math is recomputed client-side in at least 4 places** (`TenantsTab.tsx`, `FinancialControlCenter.tsx` — twice in the same file, `TenantProfilePage.tsx`) using local `Date.now()`-based day-diff formulas, instead of reading the `overdue_days` field the backend's `normalize.ts` layer already surfaces. These can disagree with the backend and with each other around timezone/midnight boundaries.
- **A full late-fee calculation is reimplemented** in `app/components/settings/BillingSection.tsx` (grace-day offsetting, three fee-rule types, a max-fee cap — the same shape as the backend's actual late-fee engine) purely to preview settings changes. If the backend's real rounding/edge-case behavior ever diverges from this hand-copied formula, the preview will lie to the owner configuring it.
- **Security-deposit auto-calculation is duplicated** in `AddTenantModal.tsx` (`deposit = months × rent`) for live-preview UX as an owner types a custom rent — fine as UX, but a formula the backend might extend (rounding, clamps) without the frontend copy knowing.
- **Portfolio-level KPI rollups** (collection rate, expense ratio, weighted on-time-percentage averages) are computed by combining raw per-hostel numbers inside `FinancialControlCenter.tsx` and `financeInsights.ts` rather than being served pre-aggregated. Lower risk than the above (advisory analytics, not authoritative amounts owed), but still a calculation an owner might treat as authoritative that the frontend, not the backend, actually produced.

By contrast, `features/tenants/utils/` (`billingDisplay.ts`, `financialColors.ts`, `groupFinancialActivity.ts`, `normalize.ts`) — the folder that looked riskiest by name — turned out to be **✅ Reuse as-is**: all four files format/map already-final backend-supplied values, with zero recalculation.

**Recommendation**: for the rewrite, replace the recomputed values with the backend-supplied equivalents everywhere they already exist (overdue days), and turn the settings-preview late-fee/deposit calculators into calls to a backend preview endpoint if StayO wants live previews (checking `docs/migration/backend-gap-analysis.md` — the late-fee engine itself is backend `✅ Reuse`, so a preview endpoint is a small addition, not new business logic).

## Type/Enum Drift — 🔄 Refactor, do before wiring any status-dependent UI

Cross-checked `shared/types/*` against the backend's real Prisma enums (`apps/backend/prisma/schema.prisma`):

- **`TenantStatus` is defined two different, mutually inconsistent ways inside the frontend itself** — `shared/types/tenant.ts` (4 values, including `INACTIVE`/`MOVED_OUT` which don't exist on the backend) and `features/tenants/utils/normalize.ts` (7 values, including `MOVE_OUT_REQUESTED` and `LEFT`, neither of which exist on the backend either — the real terminal state is `FORMER_TENANT`). The actual backend enum has exactly 5 values: `INVITED | ACTIVE | FORMER_TENANT | EXPIRED | CANCELLED`. Two wrong definitions, not one.
- **`PaymentStatus`**: backend has 8 uppercase values (`UPCOMING | PENDING | PARTIAL | PAID | OVERDUE | WAIVED | DRAFT | CANCELLED`); frontend has 6 lowercase values, missing 3 real ones and inventing a `FAILED` value that doesn't exist on the backend.
- **`Role`**: frontend defines 4 roles (`admin`/`owner`/`tenant`/`warden`, lowercase); the backend's actual `Role` enum has only 2 (`OWNER`/`TENANT`, uppercase) — consistent with the backend gap analysis's finding that ADMIN isn't a real assignable role today. This may be intentional (admin/warden modeled outside the core `Role` enum) but needs explicit verification before StayO's Super Admin/Warden UI is built against it.
- **`MoveOutStatus` is the one done right** — matches the backend's 9-value enum exactly, and even includes a `canonicalMoveOutStatus()` mapping function for two legacy values. Use this file as the template for fixing the other three.

**Recommendation**: define exactly one `TenantStatus`, `PaymentStatus`, and `Role` type per concept, generated from or explicitly checked against the backend enums, before any StayO screen is built that branches on these values.

---

# Dead code — confirmed for deletion

**Orphaned components** (zero imports found anywhere in `src`):
`app/components/HostelCard.tsx`, `hand-writing-demo.tsx`, `bouncing-dots-demo.tsx`, `app/components/modals/PricingRatesModal.tsx`, `app/components/figma/ImageWithFallback.tsx`, `app/components/views/tenants/AcademicMixChart.tsx`, `features/tenants/components/modals/InviteTenantModalV2.tsx` (alias of `AddTenantModal.tsx`), `features/tenants/components/dashboard/TenantsDashboard.tsx`, `features/tenants/components/score/TenantScoreCard.tsx`, `features/tenants/components/profile/RecentActivity.tsx`, `features/tenants/components/profile/FloatingActionMenu.tsx`, `features/tenants/components/profile/ComplaintsSection.tsx`, `features/tenants/components/profile/StickyOpsBar.tsx`, `features/tenants/components/actions/ReminderActionBar.tsx`.

**Unused generated shadcn primitives** (12 of them, zero references): `aspect-ratio.tsx`, `pagination.tsx`, `hover-card.tsx`, `resizable.tsx`, `navigation-menu.tsx`, `calendar.tsx`, `breadcrumb.tsx`, `menubar.tsx`, `sidebar.tsx`, `collapsible.tsx`, `context-menu.tsx`, `carousel.tsx`.

**Already known from the earlier legacy sitemap pass**, restated here for completeness: `components/marketing/` (11 files, confirmed dead, superseded by `components/landing-v2/`), `default_shadcn_theme.css` and `scratch.mjs` (already deleted during the repo reorg), `app/components/views/{AdmissionsView,HostelsView,TenantsHostelView}.tsx` (built but never routed).

**Indirection layers**: `services/index.ts`, `domains/*/index.ts` (outer barrels only — see API layer section above for the nuance on `domains/*/api/`), `infrastructure/api/client.ts`, `infrastructure/query/client.ts`.

---

# Broken navigation — 1 confirmed

`features/tenants/components/profile/TenantProfilePage.tsx:481` navigates to `/changes?tenantId=...` on a "view all changes" click. **No `/changes` route is defined anywhere.** This page is live (reachable via `/hostels/:hostelId/tenants/:tenantId`), so this is a real dead-end in production today — the click silently bounces the user to the homepage via the router's catch-all redirect. Fix during rewrite (either add the route or point the link at wherever change-request history actually lives).

Every other navigation call site checked out clean against the real route table.

---

# Reuse Summary

| Layer | Classification | Why |
|---|---|---|
| `lib/api-client.ts` | ✅ Reuse as-is | Production-grade axios client; fix the hardcoded legacy URL fallback only. |
| `features/*/api/*` (17 modules) | ✅ Reuse as-is, 🔄 fix broken calls + convert to TS | Consistently uses the sanctioned client; several stale/decommissioned endpoint calls need correcting. |
| `infrastructure/`, `services/index.ts`, `domains/*/index.ts` | ❌ Delete | Confirmed dead indirection, 0-1 real consumers across all three. |
| React Query setup (`queryClient.ts`, `queryKeys.ts`) | ✅ Reuse as-is | Well-designed; just needs consistent adoption (see below). |
| Query-key usage across the app | 🔄 Refactor | Good factory exists but is fragmented across 3 competing conventions. |
| `AuthContext.tsx` | 🔄 Refactor | Auth/session logic is solid; split out the bundled idle-timeout concern. |
| `tenantStore.ts` (Zustand) | ✅ Reuse as-is | Small, well-scoped; only instance of this pattern. |
| `features/tenants/hooks/*`, `tenant-portal/hooks/*`, `change-management/hooks/*`, `owner-actions/hooks/*` | ✅ Reuse as-is | Good "hook wraps API" examples. |
| The other 13 features' inline API-in-component pattern | 🔄 Refactor | Decompose into hooks following the 4 good examples. |
| Forms (all modals) | ❌ Rewrite | No shared pattern exists; RHF/Zod are present but unused. |
| `features/tenants/utils/*` | ✅ Reuse as-is | Pure display/mapping, no recalculation despite the risky-sounding folder name. |
| Recomputed overdue-days, late-fee preview, deposit auto-calc | 🔄 Refactor | Real business-logic leakage; fixable by consuming backend fields/endpoints instead. |
| Portfolio KPI rollups (`FinancialControlCenter.tsx`, `financeInsights.ts`) | 🔄 Refactor | Lower-risk leakage (advisory analytics), same fix direction. |
| `shared/types/tenant.ts`, `payment.ts`, `roles.ts` | 🔄 Refactor | Enum drift against real backend values; `moveout.ts` is the template to copy. |
| Dead components (14 files), unused shadcn primitives (12 files) | ❌ Delete | Zero references found anywhere. |

---

# Sequencing recommendation

1. **Before any StayO screen is built**: fix the enum drift (`TenantStatus`/`PaymentStatus`/`Role`) and delete the dead indirection layers — both are foundational and cheap to fix now versus expensive to untangle later.
2. **Reuse directly, minimal changes**: the API client, the per-feature API modules (after fixing the ~10 broken/stale calls found), React Query setup, the 4 well-built hook modules, `tenants/utils/*`.
3. **Needs a deliberate new pattern, not a port**: forms (no existing pattern to preserve), the 13 features missing a hooks layer (decompose following the existing good examples).
4. **Fix before or during, not a blocker**: the 4 spots of business-logic leakage (overdue days, late-fee preview, deposit auto-calc, portfolio KPIs) — each is a small, isolated fix (consume a backend field/endpoint instead of recomputing), not an architectural problem.

See `docs/migration/page-mapping.md` for the full verified page-by-page and endpoint-by-endpoint detail behind these findings.
