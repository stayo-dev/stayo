# StayO Page Mapping — Legacy Frontend ↔ Backend Verification

Version: 2.0 — rewritten from live code inspection
Status: Living document
Last Updated: July 2026
Supersedes: v1.0, which mapped invented StayO routes (`/owner/rooms`, `/admin/owners`, `/owner/food/polls`) to a generic "✅ Existing" backend status without checking either side against real code.

---

# Purpose

This is the endpoint-by-endpoint companion to `docs/migration/frontend-migration-plan.md`. It documents **every actual API call the legacy frontend makes**, cross-checked call-by-call against the verified backend endpoint list in `docs/migration/api-reuse-checklist.md`, organized by the frontend feature module that owns the call. This is a verification artifact for the legacy codebase, not a StayO page plan — StayO's actual page structure will be mapped fresh once real StayO designs are available (see the project-scope note in the repo's memory: legacy UI/routes are reference-only, never the target).

# Legend

✅ Verified — call target matches a real, live backend endpoint
⚠️ Broken — call target matches a **decommissioned** or **non-existent** backend endpoint (will fail in production)
📭 Unused — a real backend endpoint the frontend never calls (not a problem, just noted for completeness)

---

# Auth — `features/auth/api/index.js`, `context/AuthContext.tsx`

| Frontend call | Status | Notes |
|---|---|---|
| `/auth/login`, `/auth/me`, `/auth/register`, `/auth/change-password`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/confirm-identity`, `/auth/refresh`, `/auth/logout`, `/auth/google-callback`, `/auth/activity`, `/auth/csrf`, `/auth/send-phone-otp`, `/auth/verify-phone-otp`, `/events-token` | ✅ | Full core auth flow correctly wired. |
| `/auth/onboarding-login` | — | Referenced only as a string in `api-client.ts`'s public-route allowlist; never actually called. Not broken, just unreachable dead reference. |

📭 Unused: `/auth/logout-all`, `/auth/reset-onboarding-password`, `/events` (the SSE stream — `events-token` is fetched but no `EventSource` connection ever opens with it).

---

# Owners — `features/owners/api/index.js`

| Frontend call | Status | Notes |
|---|---|---|
| `/owner-actions`, `/owner/activity-logs`, `/owner/billing/frequency-requests` (+decision), `/owner/hostels`, `/owner/hostels/{id}/agreement-template` (+preview, +signature), `/owner/me/hostel`, `/owner/me/preferences`, `/owner/me/profile`, `/owner/portfolio/summary`, `/owner/search`, `/owner/whatsapp/*`, `/owners/invitations` | ✅ | |
| `/owner/logo` (`uploadLogo`/`removeLogo` fallback) | ⚠️ Broken | Route returns `410 MOVED_TO_HOSTEL_SCOPED_ROUTE` — should call `/hostels/{id}/logo` instead (which the frontend *also* correctly calls elsewhere — this is a stale fallback path, not the only path). |
| `/owner/me/activation` (`activationService.get`/`persistStep`) | ⚠️ Broken | Entire decommissioned "single-business migration" route (410 Gone). This service export appears to be dead code targeting a route that no longer exists. |

📭 Unused: `/owner/integrity`, `/owner/payments/offline`. Also unused: `ownerService.updateSectionConfig()` has zero callers, meaning none of the 7 hostel `*-config` PATCH endpoints (`automation-config`, `billing-config`, `notification-config`, `payment-config`, `receipt-config`, `security-config`, `system-config`) are actually exercised by any UI today, despite the API wrapper existing for them.

---

# Hostels — `features/owners/api/index.js`, `app/components/settings/*`

| Frontend call | Status |
|---|---|
| `/hostels/{id}` (PATCH), `/hostels/{id}/preferences` (GET/PATCH), `/hostels/{id}/billing-defaults`, `/hostels/{id}/logo`, `/hostels/{id}/preferences/metadata`, `/hostels/{id}/preferences/inspector`, `/hostels/{id}/preferences/simulate` | ✅ |

---

# Floors, Rooms & Allocations — `features/rooms/api/index.js`

| Frontend call | Status | Notes |
|---|---|---|
| `/floors`, `/floors/{id}`, `/rooms`, `/rooms/{id}`, `/rooms/{id}/overview`, `/rooms/{id}/invite-defaults`, `/allocations`, `/allocations/{id}/end`, `/allocations/shift`, `/allocations/tenant/{id}` | ✅ | |
| `/allocations/owner-history` (`allocationService.getHistory`) | ⚠️ Broken | Not a real backend path. |

📭 Unused: `/allocations/my-room`.

---

# Tenants — `features/tenants/api/index.js`, `features/tenant-portal/api/index.js`

Coverage is very broad — the tenant lifecycle is the most fully-wired module in the frontend. All of these are ✅ verified:
`/tenants`, `/tenants/{id}`, `/tenants/{id}/full`, `/tenants/owner/tenants/{id}/overview`, `/tenants/{id}/documents` (+verify/reject/message/bulk-verify), `/tenants/activate` (+context/photo/signature), `/tenants/by-profile/{id}`, `/tenants/me/profile`, `/tenants/me/complete-profile`, `/tenants/me/documents`, `/tenants/me/payments/history`, `/tenants/me/room`, `/tenants/me/onboarding-settings`, `/tenants/me/score`, `/tenants/{id}/score`, `/tenants/me/financial-ledger`, `/tenants/me/billing-frequency`, `/tenants/me/billing-timeline`, `/tenants/{id}/billing-timeline`, `/tenants/{id}/reactivate`, `/tenants/me/reactivation-request`, `/tenants/owner/reactivation-requests` (+decision), `/owners/invitations`, `/tenants/resend-invitation`, `/tenants/{id}/cancel-invitation`, `/tenants/{id}/compliance-action`, `/tenants/{id}/financial-ledger`, `/tenants/{id}/financial-timeline`, `/tenants/pending-documents`, `/tenants/export`, `/tenants/{id}/notes`, `/tenants/{id}/change-rent`, `/tenants/{id}/change-frequency` (+custom), `/profiles/unassigned/tenants`, `/tenants/me/financial-read-model`, `/tenants/me/photo`, `/bulk-import/*` (all 6 endpoints).

| Frontend call | Status | Notes |
|---|---|---|
| `/profiles/complete` (`completeMyProfile` 404 fallback) | ⚠️ Broken | Not a real path; dead legacy fallback. |

📭 Unused: `/tenants/increment-year`, `/tenants/onboarding/complete`, `/tenants/{id}/documents/{docId}/download`, `/tenants/{id}/financial-ledger/adjust`, `/tenants/{id}/financial-ledger/refund-status`, `/tenants/transfer`, `/tenant/exit`, `/profile/me`, `/profile`, `/profiles/{id}` (only the `unassigned` variant is used).

---

# Complaints

**No frontend code calls any complaint-related path.** `ComplaintsSection.tsx` (itself dead/unimported — see the migration plan's dead-code list) contains a code comment explicitly stating *"Complaint tracking is not yet available via API."* `domains/complaints/index.ts` is an empty placeholder export. Matches the backend gap analysis's "Complaints ❌ Replace" finding exactly — neither side has anything to reuse here.

---

# Payments & Billing — `features/payments/api/index.js`, `domains/payments/api/verify.ts`

Broad, correct coverage: `/payments`, `/payments/dues`, `/payments/tenant-dues`, `/payments/pay-dues`, `/payments/record-offline`, `/payments/verify`, `/payments/reconcile`, `/payments/create-intent`, `/payments/test-intent`, `/payments/attempts/{id}`, `/payments/confirm`, `/payments/pending-verification`, `/payments/manual-confirm`, `/rent/generate`, `/payments/obligations` (+waive/cancel/history), `/payments/{id}` (+receipt), `/invoices/{id}`, `/payments/preview`, `/payments/settlement-preview`, `/payments/quick-collect/search`, `/payments/pay-link`, `/verify/receipt` — all ✅.

| Frontend call | Status | Notes |
|---|---|---|
| `/payments/initiate` | ⚠️ Broken | Dead leftover — `createIntent()` right beside it correctly calls `/payments/create-intent`; this function looks superseded but not removed. |
| `/payments/submit-reference` | ⚠️ Broken | Not a real path. |
| `/payments/export` | ⚠️ Broken | Not a real path. |
| `/payments/bulk-generate` | ⚠️ Broken | Not a real path. |

📭 Unused: `/payments/offline` (the alias route — `/payments/record-offline` is used directly instead, which is fine), `/payments/settlement-plan`, `/payments/generate-preview`, `/payments/tenant/{id}`, and notably `/payments/pay/{token}` — the frontend generates pay-links (`/payments/pay-link`) but this SPA never calls the redemption route itself, since that's meant to be opened by the *recipient* (often outside the app, via WhatsApp), not the SPA.

---

# Food

**Confirmed clean** — no `food`/`menu`/`meal` path anywhere in the frontend. Matches the backend's confirmed zero food presence.

---

# Reports / Dashboard — `features/dashboard/api/index.js`, `features/reports/api/index.js`

✅ `/dashboard`, `/dashboard/summary`, `/dashboard/stats`, `/dashboard/stats-shell`, `/dashboard/stats-activity`, `/dashboard/stats-analytics`, `/dashboard/monthly-stats`, `/dashboard/cashflow`, `/dashboard/funnel`, `/dashboard/operations`, `/dashboard/portfolio-shell`, `/dashboard/portfolio-performance`, `/dashboard/tenants`, `/owner/portfolio/summary`.

Note: `features/reports/` is a naming artifact, not a real distinct module — it only proxies to `/dashboard/*` and activity endpoints. No `/reports/*` path exists on the backend or is called by the frontend; both sides agree on this.

| Frontend call | Status | Notes |
|---|---|---|
| `/activity/list` (`features/activity/api/index.js`) | ⚠️ Broken | Not a real path — only `/auth/activity` and `/owner/activity-logs` exist. |
| `/activity` (`features/reports/api/index.js`) | ⚠️ Broken | Same issue, different file. The correct endpoint (`/owner/activity-logs`) IS used correctly elsewhere, in `ActivityLogsView.tsx`/`HostelActivityCenterView.tsx` — these two calls look like earlier, superseded attempts. |

📭 Unused: `/dashboard/tenant` (singular — the plural `/dashboard/tenants` is used instead), `/analytics/dashboard`, `/metrics`, `/metrics/reset`.

---

# Notifications — `features/notifications/api/index.js`

✅ `/notifications`, `/notifications/{id}/read`, `/notifications/send-reminder`, `/notifications/test-reminder` — full, correct coverage.

---

# Admin

**No frontend code calls any `/admin/*` path.** Consistent with `platforms/admin/` being an empty router stub with zero UI built. Nothing to verify here — this entire module is unimplemented on the frontend, matching the backend gap analysis's finding that the ADMIN role itself doesn't functionally exist yet either.

---

# Agreements, Renewals, Move-out — `features/agreements/api/index.js`, `features/move-out/api/index.js`, `features/change-management/api/index.ts`, `features/recovery/api/index.ts`

Core coverage is ✅: `/agreements/{id}/lifecycle-recovery` (+renewal-draft, +renewal-offer, +sign-renewal), `/agreements/history`, `/agreements/lifecycle-recovery`, `/agreements/renewal-offers`, `/agreements/renewals`, `/tenant/agreement-renewal`, `/tenant/renewal-offer` (+accept/decline/discuss), `/tenants/me/renewal-signature`, `/change-requests` (+id/approve/reject/cancel), `/move-out/requests` (+all sub-actions), `/move-out/tenant`, `/move-out/timeline`, `/move-out/analytics`, `/recovery/cases` (create).

| Frontend call | Status | Notes |
|---|---|---|
| `/agreements/lifecycle-recovery/completion`, `/agreements/lifecycle-recovery/export`, `/agreements/renewal-offers/{id}/send`, `/agreements/renewal-offers/{id}` (PATCH), `/agreements/renewals/{id}`, `/recovery/cases/{id}/validate`, `/recovery/cases/{id}/execute`, `/recovery/cases/{id}` (GET) | ⚠️ Needs re-verification | These sub-routes don't appear in the verified backend endpoint list, but the list's Agreements/Renewals/Move-out section was given lighter-depth treatment during the backend audit than the core 12 modules — these are plausible real REST actions the audit simply didn't enumerate at that depth, not confirmed-broken like the flags elsewhere on this page. Re-check directly against `apps/backend/app/api/agreements/` and `apps/backend/app/api/recovery/` route files before assuming either way. |

📭 Unused: `/agreements/r4-readiness`, `/agreements/renewal-audiences`, `/move-out/vacancies`.

---

# Admissions, Leads, Visit — `features/admissions/api/index.js`

✅ `/admissions/leads` (GET/POST), `/admissions/qr-code`, `/leads/{id}` (GET/PATCH), `/leads/{id}/notes`, `/leads/{id}/reserve-room`, `/leads/{id}/reservations/{id}/cancel`, `/leads/{id}/convert-to-invitation`, `/visit/{hostelSlug}` (+leads, +activities).

| Frontend call | Status | Notes |
|---|---|---|
| `/admissions/leads/analytics` | ⚠️ Broken | The real endpoint is `/leads/analytics` (no `/admissions` prefix). Near-certain typo/copy-paste error. |

📭 Unused: bare `/leads` (list) — the frontend only ever lists via `/admissions/leads`.

---

# Expenses — `features/expenses/api/index.js`

`/expenses` (GET/POST), `/expenses/{id}` (PUT/DELETE), `/expenses/export` — **note**: this module wasn't in the original 12-module backend research scope, so it's absent from the verified endpoint list referenced throughout this document. It is **not** flagged as broken — `apps/backend/app/api/expenses/` (including `[id]` and `export` subroutes) was confirmed to exist during the initial repo-wide route survey, before the 12-module deep-dive began. Treat these calls as ✅ pending the same depth of verification given to the other modules, not as a genuine gap.

---

# Reconciliation of the "broken calls" list against migration priority

None of the 12 confirmed-broken calls above (`/owner/logo`, `/owner/me/activation`, `/allocations/owner-history`, `/profiles/complete`, `/payments/initiate`, `/payments/submit-reference`, `/payments/export`, `/payments/bulk-generate`, `/activity/list`, `/activity`, `/admissions/leads/analytics`) are on the critical path of any *primary* user flow — each has either a working alternate call elsewhere in the same file, or is genuinely dead/unreachable code. None of them block frontend architecture reuse; they're a cleanup list for whoever ports the affected `features/*/api` files, not a sign the API layer itself is unreliable.
