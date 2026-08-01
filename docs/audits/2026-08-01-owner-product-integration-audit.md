# Stayo — Owner Product Integration Audit

**Date:** 2026-08-01 · **Scope:** owner-side product, `apps/frontend` ↔ `apps/backend`
**Method:** static trace of every live owner route → hook → API wrapper → route handler → service → Prisma. Reachability from `src/main.tsx` computed mechanically (import-graph walk). No browser run — every claim below cites a file.

Companion documents:
- [API Coverage Matrix](./2026-08-01-api-coverage-matrix.md)
- [Owner Journey Checklist](./2026-08-01-owner-journey-checklist.md)

---

## 1. Executive summary

**Overall owner-product completion: ~45%.**

Not "45% of screens exist" — nearly every screen renders. 45% is the share of owner workflows that survive a full trace from click to database and back.

The single most important finding is not a bug. It is this:

> **Stayo has two owner frontends. The deep one was unplugged from the router; the shallow one shipped.**

The `/owner/*` tree that a real logged-in owner sees today was built from the `Stayo App.dc.html` mockup. A 2026-07-26 "salvage" pass moved 8 flows into it from the previous owner app and then deleted that app's route entries. **107 of 382 frontend source files (28%) are now unreachable from `main.tsx`** — including the entire obligation-management UI, the KYC verification panel, the change-request module, the room-transfer sheet, private notes, the complaints section, and the recovery/corrections modal. These are real, backend-wired, working components. They are simply not imported by anything the router can reach.

That is why the live app has dead buttons that look like oversights but are actually amputations: `+ Add Charge` on Tenant Detail has no `onClick` because `CreateObligationModal.tsx` was left behind.

### What is genuinely production-grade

| Area | Evidence |
|---|---|
| Backend business logic | 359 route files, ~140 services, FIFO settlement engine, late-fee engine, obligation immutability, move-out state machine, correction/recovery cases |
| Owner data isolation | Every hostel-scoped route calls `requireHostelBelongsToOwner` / `assertHostelBelongsToOwner` (`lib/security/scoped-query.ts`). Verified on `/api/rooms`, `/api/floors`, `/api/tenants`. No leak found. |
| Auth/session | Supabase JWT verified against JWKS in `middleware.ts`, Redis deny-list revocation, 30-min idle timeout, CSRF pair check, identity headers stripped on every path |
| Step-up confirmation | `identityService.confirmIdentity(password, purpose)` gates Quick Collect and Change Rent — real, not decorative |
| Quick Collect (payment) | 5-step flow, real FIFO `settlementPreview`, real `record-offline`, 5 cache invalidations. The best-built screen in the app. |
| Move-out | All 7 lifecycle mutations wired (submit/inspect/reject/settle/vacate/complete/cancel) |
| Food — Monthly Schedule | Real 5-table model, voting, weighted round-robin generator, publish, carry-forward cron |
| Expenses | Full CRUD + export + real KPI/category/vendor/trend reads |

### What is not

| Area | State |
|---|---|
| Alerts (the owner's inbox) | **100% mock.** `useAlerts.ts` is `useState(mockLeads)`. Every action is `stayoToast.info('Coming soon')`. The bell badge on Home is computed from *real* data and leads to a *fake* page. |
| Agreements | **Zero owner UI.** No route. Backend has renewal offers, bulk campaigns, lifecycle recovery, templates, clause library. |
| KYC verification | Owner can **see** document status, cannot approve or reject. `VerificationPanel.tsx` is orphaned. |
| Charges / obligations | Owner cannot create, cancel, or waive a charge. All three modals orphaned. |
| Receipts | Generated server-side on every payment (`receiptService.createReceipt`), **never surfaced to the owner**. |
| Search | `/api/owner/search` exists. Home's search bar is a `<span>` with no handler. |
| Notifications / reminders | `/api/notifications`, `/api/notifications/send-reminder` exist. No owner UI. |
| Configuration sub-app | 12 routes under `/owner/config/*`, all `RouteScaffold` ("Not built yet"). Backend endpoints exist for all 12. |
| Complaints | `complaints` table exists in `schema.prisma:104`. **Zero routes, zero services, zero UI.** Fully dead. |
| Reports / analytics | `/api/dashboard/stats-analytics`, `/api/reports/*`, funnel, portfolio-performance — no consumer. |
| Bulk tenant import | Full backend module (`/api/bulk-import/*`, 6 endpoints). No owner UI. |

### The pattern behind the numbers

The frontend is **experience-driven** (Home / Tenants / Money / Food / Configure). The backend is **entity-driven** (hostels → tenants → agreements → obligations → payments). Where a design screen happened to align with an entity, the wiring is excellent. Where the design had no screen for an entity — agreements, obligations, receipts, notifications — the entity has no UI at all, regardless of how mature its backend is.

This is why the recommendation at the end of your brief is right, and this audit reinforces it: **assign work by complete journey, not by page.**

---

## 2. Live owner surface — what actually ships

Router: `apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx`, gated by `OwnerProviderShell` → `ProtectedRoute allowedRoles={['owner']}`.

**19 real routes + 12 empty scaffolds = 31.**

```
/owner/home                             OwnerDashboardPreviewPage    REAL
/owner/tenants                          TenantsPage                  REAL (capped at 50/hostel)
/owner/tenants/:tenantId                TenantDetailPage             REAL read / 4 dead controls
/owner/money                            MoneyPage                    REAL
/owner/food                             FoodPage                     REAL schedule / MOCK polls
/owner/alerts                           AlertsPage                   MOCK
/owner/more                             MorePage                     MOCK header
/owner/more/workspace-configuration     MoreWorkspaceConfigPage      REAL
/owner/more/settings                    MoreSettingsPage             REAL nav / 1 mock row
/owner/more/billing                     MoreBillingPage              REAL (primary hostel only)
/owner/more/profile                     MoreProfilePage              REAL
/owner/more/hostel                      MoreHostelIdentityPage       REAL
/owner/more/notices                     MoreNoticesPage              REAL (primary hostel only)
/owner/more/service-requests            MoreServiceRequestsPage      REAL (primary hostel only)
/owner/more/help                        MoreHelpPage                 STATIC
/owner/more/about                       MoreAboutPage                STATIC
/owner/hostels/:id/overview             HostelOverviewPage           REAL
/owner/hostels/:id/rooms                HostelRoomsPage              REAL
/owner/hostels/:id/tenants              HostelTenantsPage            MOCK — always empty
/owner/config/*  (12 routes)            RouteScaffold                "Not built yet"
```

---

## 3. Module-by-module audit

### 3.1 Authentication — **90% · production-ready with one gap**

| Check | Result |
|---|---|
| Login | ✅ `POST /api/auth/login` → `supabase.auth.setSession()`. Rate limiting, tenant-status gates, JIT identity linking all backend-mediated. |
| Owner signup | ✅ `POST /api/auth/owner-signup` creates a real `profiles` row. |
| Session | ✅ Supabase ES256 JWT, JWKS-verified in `middleware.ts`, no shared secret, no per-request network call. |
| Logout | ✅ `POST /api/auth/logout` (Redis revocation + `supabase.auth.admin.signOut()`) then local `signOut()`. |
| Idle timeout | ✅ 30 min, Redis-enforced server-side + client warning modal. |
| Owner isolation | ✅ Every scoped route calls `requireHostelBelongsToOwner`. Verified on rooms/floors/tenants. |
| Route protection | ✅ `ProtectedRoute allowedRoles={['owner']}`. |
| Role separation | ✅ ADMIN cannot enter `/owner/*`; owner cannot enter `/admin/*`. |
| CSRF | ✅ cookie/header pair, unsafe methods only. |
| Identity-header smuggling | ✅ `stripIdentityHeaders()` runs on **every** path including public. |

**Gap (P2):** `ProtectedRoute` redirects an unauthenticated deep link to `/` and stores `state.from`, which **nothing ever reads**. An owner clicking a link to `/owner/tenants/<id>` while logged out lands on the marketing page and loses their destination.
`apps/frontend/src/app/components/ProtectedRoute.tsx:22`

**Note (P3):** `useOwnerSession` treats `role === 'admin'` as an owner (`legacyAuthAdapter.ts:22`) while `ProtectedRoute` does not. Harmless today, a trap later.

---

### 3.2 Onboarding — **70% · creates a real business, but loses data and cannot be retried**

Your stated understanding was that the wizard "collects information but does not actually create the business." **That is no longer true.** Trace:

```
AccountStep    → POST /auth/send-phone-otp → POST /auth/verify-phone-otp
               → POST /auth/owner-signup           → profiles row      ✅
               → AuthContext.login()               → real session      ✅
KycStep        → POST /api/owner/kyc-documents     → ImageKit + row    ✅ (real since ADR-038)
PublishStep    → POST /api/owner/hostels           → hostels row       ✅
               → POST /api/floors    × F           → floors rows       ✅
               → POST /api/rooms     × F×R         → rooms rows        ✅
Dashboard      → GET /api/owner/portfolio/summary  → real numbers      ✅
```

`apps/frontend/src/features/owner-onboarding/hooks/useOnboardingSubmission.ts:132-170`

#### But four collected fields are silently discarded

`useOwnerOnboardingState.ts` collects them; `onboardingApi.createHostel()` never sends them:

| Field | Collected at | Sent? | Consequence |
|---|---|---|---|
| `type` (Boys/Girls/Co-Living/Working Pros) | CreateStep | ❌ | No column on `hostels` either — needs a migration |
| `food` (Yes/No) | DetailsStep | ❌ | Food tab has no idea whether the hostel serves food |
| `deposit` (security deposit) | DetailsStep | ❌ | `hostel_billing_preferences.default_security_deposit` stays null → every invite falls back to a policy the owner never set |
| `publishChoice` (`now` \| `draft`) | PublishStep | ❌ | "Keep as draft" publishes anyway. `hostels.listing_status` defaults to `DRAFT` regardless of the choice. |

Rooms are also created with **no `base_rent` and no `room_type`**, so the room grid shows ₹0 rent and the invite wizard cannot prefill rent from the room.

#### P0 — Publish is non-atomic and non-resumable

`submitPublish()` fires `1 + F + (F × R)` sequential HTTP calls in a bare `for` loop with no transaction and no rollback. A 4-floor × 10-room hostel is **45 sequential requests**.

If any call fails midway:
- the owner sees `stayoToast.error('Could not publish your hostel')`
- a **partially built hostel already exists in the database**
- pressing Publish again hits the owner-scoped duplicate-name guard (`app/api/owner/hostels/route.ts:139`) and returns `400 A hostel with this name already exists`

The owner is now permanently stuck on step 11 with a half-built hostel and no path forward inside the wizard. Recovery requires knowing to navigate to `/owner/hostels/:id/rooms` — where the header will read "Hostel" (see 3.3).

**Fix:** one `POST /api/owner/hostels/provision` that takes `{hostel, floors, roomsPerFloor, bedsPerRoom, baseRent}` and does the whole thing in a single Prisma transaction.

#### Beds are not an entity

The wizard has a BedsStep; `rooms.capacity` is the only persisted representation. `useHostelRooms.ts:23-42` **synthesises** `beds[]` client-side from `occupied`/`reserved`/`capacity` counts. There is no per-bed identity anywhere in the system, so "assign tenant to bed 3" is not expressible. This is a deliberate documented choice — but it means the BedsStep is decorative and the 4-dot bed indicator is a rendering of counts, not of beds.

---

### 3.3 Hostel management — **35% · the weakest core module**

| Capability | UI | Backend | Wired |
|---|---|---|---|
| Create first hostel | ✅ onboarding | ✅ | ✅ |
| **Create additional hostel** | ❌ `stayoToast.info('Coming soon')` | ✅ `POST /api/owner/hostels` | ❌ **P0 for multi-tenant SaaS** |
| Edit hostel identity | ✅ `/owner/more/hostel` | ✅ | ✅ |
| Delete / archive hostel | ❌ | ✅ (`archived_at`/`archive_reason` on `hostels`) | ❌ |
| Hostel switcher | ⚠️ only inside Tenants list | ✅ `is_multi_hostel` returned | partial |
| Hostel settings (billing) | ✅ | ✅ | ⚠️ primary hostel only |
| Owner isolation | — | ✅ | ✅ |

#### P0 — "+ Add hostel" is a toast

`OwnerDashboardPreviewPage.tsx:56` → `onAddHostel={() => stayoToast.info('Coming soon')}`.
The entire premise of the SaaS transformation is that an owner runs multiple hostels in one workspace. Today they can create exactly one, during onboarding, and never another.

#### P1 — Hostel drill-down header reads mock data

```ts
// features/hostel-drilldown/layout/HostelDrilldownLayout.tsx:4,20
import { mockProperties } from '@shared/mocks/dashboard';
const property = mockProperties.find((p) => p.id === hostelId);
```
`hostelId` is a real UUID. `mockProperties` ids are `'p1'`, `'p2'`. The lookup **always returns undefined**, so every real hostel's drill-down renders the title `"Hostel"` and the subtitle `"— · Running"`. Occupancy/status chrome is equally fake.

#### P1 — Hostel → Tenants sub-tab is always empty

```ts
// features/hostel-drilldown/pages/HostelTenantsPage.tsx:16
const hostelTenants = useMemo(() => mockTenants.filter((t) => t.hostelId === hostelId), [hostelId]);
```
Same UUID-vs-`'p1'` mismatch. The tab shows **0 tenants, ₹0.0L total due, 0 overdue** for every hostel, forever — while the sibling Overview tab (real data) shows the true counts one tap away. Two adjacent tabs contradict each other.

#### P1 — Multi-hostel screens silently pick hostel #1

`useOwnerSession().primaryHostelId` is `hostels[0]?.id` (`legacyAuthAdapter.ts:42`). Three screens use it with **no hostel picker**:

- `MoreBillingPage.tsx:25` — billing policy, late fees
- `MoreNoticesPage.tsx:21` — announcements & events
- `MoreServiceRequestsPage.tsx:27` — maintenance queue

A two-hostel owner editing late fees is editing hostel #1's and cannot tell. This is the exact anti-pattern `apps/backend/scripts/architectural-invariants-check.ts` forbids on the backend — but that script does not scan the frontend, so it does not catch this.

---

### 3.4 Building structure (floors / rooms / beds) — **70%**

| Capability | Status |
|---|---|
| List floors + rooms grouped | ✅ `GET /api/rooms?grouped=true`, real occupancy/reserved counts |
| Create floor | ✅ `POST /api/floors` |
| Create room | ✅ `POST /api/rooms` |
| Move room between floors (drag) | ✅ persists via `PATCH /api/rooms/:id { floor_id }` |
| Room detail sheet | ✅ real occupants, links to tenant detail |
| **Edit room** | ❌ `stayoToast.info('Coming soon')` (`RoomSheetModal.tsx:40`) — `roomService.update` exists |
| **Delete room** | ❌ no UI — `roomService.delete` exists |
| **Delete / rename floor** | ❌ no UI — `DELETE /api/floors/:id` exists |
| Room types | ❌ never set, never shown |
| Room base rent | ❌ never set at creation; grid shows ₹0 |
| Bed-level identity | ❌ not modelled (see 3.2) |
| Vacancy | ✅ real, derived from `capacity − allocations − reservations` |

**P2:** `AddFloorModal`'s "add N rooms with the floor" runs `createRoom` in a sequential `await` loop (`HostelRoomsPage.tsx:150-158`) — the same non-atomic pattern as onboarding publish, same partial-failure exposure.

---

### 3.5 Tenant lifecycle — **45% · the highest-value gap**

```
Invite ──✅──> Tenant receives ──⚠️──> Accepts ──✅──> KYC ──❌──> Agreement ──✅──>
Room alloc ──✅──> Move-in ──✅──> Rent gen ──✅──> Payment ──✅──> Renewal ──❌──>
Move-out ──✅──> Vacancy ──✅
```

#### ✅ Works

- **Invite** — 4-step wizard → `POST /api/owners/invitations`. Creates: `profiles` + `tenants` (`INVITED`) + `room_allocations` + **rent/deposit/maintenance obligations** in one service transaction (`tenant-invitation-lifecycle-service.ts:380`). Real vacant-room picker from `GET /api/rooms?grouped=true`.
- **Activation** — `/activate/:token` → password → agreement generation (`AgreementGenerationService`) → rules acceptance → profile → `ACTIVE`. Rent schedule built by `agreement-rent-schedule-service`.
- **Move-out** — `MoveOutSheet.tsx` wires all 7 mutations with correct cache invalidation. Genuinely complete.
- **Vacancy** — updates automatically; `cron-move-out-releases` runs nightly.

#### ❌ Broken or missing

**P0 — The invite success screen lies about delivery.**
The backend is careful: it returns `201` when WhatsApp or email succeeded and `202` when neither did, with `whatsapp_sent`, `whatsapp_error`, `email_sent`, `needs_email`, and the `activation_link` itself (`tenant-invitation-lifecycle-service.ts:105-110`).

`useInviteWizard.ts:46` ignores every one of those fields:
```ts
onSuccess: () => { setSubmitted(true); ... }
```
and the wizard renders *"Invitation sent! {name} will get a text to complete KYC."*

Compounding it: **the wizard collects no email address** (`TenantStep.tsx` has name + phone only), so the email fallback can never fire. Given the WhatsApp template drift this repo has already been fighting (commits `bd3d1e9`, `3b0fb6b`), the realistic production outcome is: owner invites 20 tenants, sees 20 success screens, and **zero tenants receive anything**. The `activation_link` needed to recover is returned by the API and thrown away by the client.

**P1 — Owner cannot verify or reject KYC.**
Tenant Detail → Documents tab renders status pills only. No approve, no reject, no message, no upload.
Backend has `POST /api/tenants/:id/documents/:docId/verify`, `/reject`, `/message`, `/bulk-verify`.
Frontend has `VerificationPanel.tsx` and `DocumentsTab.tsx` — **both orphaned**.
The Home "Verify KYC" action-centre tile counts pending documents and is not clickable.
→ *Tenants can be invited but never fully onboarded.*

**P1 — Four dead controls on Tenant Detail** (`TenantDetailPage.tsx`):

| Control | Line | Behaviour | Backend that exists |
|---|---|---|---|
| `+ Add Charge` | 264 | no `onClick` | `POST /api/payments/obligations` |
| `Upload` (documents) | 315 | no `onClick` | `POST /api/tenants/:id/documents` |
| Private Notes `+` | 213 | no `onClick`; the caption *"No private notes yet"* is hardcoded and shown even after typing | `GET/POST/DELETE /api/tenants/:id/notes` |
| `CommRowActions` (call/msg/doc/history × 2 rows) | 405 | rendered as `<span>` — not buttons | `tel:`/WhatsApp/activity log |

**P1 — "Change room" opens the wrong sheet.**
`TenantDetailPage.tsx:345` → `setActionsOpen(true)`, but `TenantActionsSheet` has **no room-change row**. The owner is shown Collect / Charges / Agreement / Check-out and no way to move a tenant. `TransferRoomSheet.tsx` exists and is orphaned; `POST /api/allocations/shift` exists.

**P1 — Tenant list silently truncates at 50.**
`useRealTenantList.ts:100` calls `tenantService.getAll(id, {})` with no `limit`/`offset`. `safePagination` defaults to `DEFAULT_LIMIT: 50` (`lib/security/api-guard.ts:13`). There is no pagination UI and no "showing 50 of N" affordance.

For a 120-bed hostel this means: 70 tenants invisible, filter chip counts wrong, **and the Money tab's Collections list wrong too** — `useRealMoney` composes `useRealTenantList`, so the truncation propagates into the collections workflow.

**P2 — Six invite-lifecycle actions have no UI:** resend invitation, cancel invitation, edit invitation, reactivate tenant, reactivation-request decisions, compliance action. All six have live endpoints and, for most, orphaned components.

**P2 — "Overdue" stat card shows a fabricated number.**
`useTenantDetail.ts:186` → `overdueMonths: Number(o.overdue_amount ?? 0) > 0 ? 1 : 0`. It is a boolean. The card labels it `days` (`TenantDetailPage.tsx:379`). A tenant 47 days overdue reads **"1 days · Needs follow-up"**.

**P2 — Charges tab shows at most 5 obligations.** `GET /api/tenants/:id/full` caps at 5 server-side; the caption says *"Showing the last N charges"* with no way to see more.

---

### 3.6 Payments — **55%**

| Capability | UI | Backend | Wired |
|---|---|---|---|
| Collect payment (offline) | ✅ Quick Collect, 5 steps | ✅ | ✅ **excellent** |
| Partial payment | ✅ any amount + FIFO preview | ✅ `buildSettlementPlan` | ✅ |
| Advance / excess | ✅ preview shows it | ✅ ledger credit | ✅ |
| Settlement preview | ✅ live as owner types | ✅ | ✅ |
| Step-up confirmation | ✅ password | ✅ `identity_tokens` | ✅ |
| Rent generation | ❌ no UI | ✅ cron + `POST /api/rent/generate` | cron only |
| **Receipt** | ❌ **nothing** | ✅ auto-created on every payment | ❌ |
| Create charge | ❌ | ✅ | ❌ |
| Cancel / waive obligation | ❌ | ✅ | ❌ (modals orphaned) |
| Payment history / ledger | ❌ | ✅ 4 endpoints | ❌ |
| Overdue list | ⚠️ Money → Collections (capped at 50) | ✅ | partial |
| Payment link | ❌ owner-side | ✅ `POST /api/payments/pay-link` | ❌ |
| Correct payment (reverse/transfer) | ❌ | ✅ recovery cases | ❌ (`CorrectPaymentModal` orphaned) |
| Move-out settlement | ✅ | ✅ | ✅ |
| Export | ❌ | ✅ `/api/payments/export` | ❌ |

**P1 — Receipts are generated and never shown.** `receiptService.createReceipt()` fires on all five payment paths (`payment-service.ts:422,477,576,735,2702`). Quick Collect's success screen even promises *"A receipt is generated and the tenant is notified"* (`QuickCollectModal.tsx:665`). The owner has no way to view, download, print or resend it. `GET /api/payments/:id/receipt` and `paymentService.downloadReceipt` both exist unused.

**P1 — Money moves in but cannot be corrected.** No void, no reverse, no transfer, no waive, no cancel. A mis-keyed ₹50,000 payment is permanent from the UI. All the backend machinery for this shipped (Business Recovery Platform) and its only frontend consumer is orphaned.

---

### 3.7 Dashboard — **70% · right numbers, dead surface**

Source: `useOwnerDashboard.ts` composing `GET /api/owner/portfolio/summary` + `/api/tenants/pending-documents` + `/api/agreements/renewals` + a per-hostel `INVITED`-count fan-out. Correctly sums across **all** hostels — no `hostels[0]` fallback. Honest about what the backend can't do (labels MTD revenue "Collected this month" rather than faking "today's").

| Card | Source | Correct? | Clickable? |
|---|---|---|---|
| Collect Rent (hero) | `aggregate.overdue_total` | ✅ | ❌ **has a `›` chevron, no handler** |
| Review Agreements | renewal queue `counts.total` | ✅ | ❌ |
| Activate Tenants | `INVITED` fan-out | ✅ | ❌ |
| Fill Vacant Beds | `aggregate.vacant_beds` | ✅ | ❌ |
| Verify KYC | pending documents | ✅ | not rendered on Home |
| Send Reminders | overdue count | ⚠️ proxy metric | not rendered on Home |
| Beds / Outstanding / Revenue | aggregate | ✅ | — |
| Collection progress | `collection_rate` | ✅ | — |
| Property cards | per-hostel snapshot | ✅ | ✅ |
| Search bar | — | — | ❌ **a `<span>`, not an input** |
| Drag handles on property cards | — | — | ❌ decorative, no DnD at `/owner/home` |
| Bell → Alerts | real count | ✅ | ✅ → **mock page** |

**P1 — The Action Center is not actionable.** Five of six tiles have no click target. The owner sees "12 tenants overdue" and has to navigate manually to Money → Collections.

**P1 — No error state anywhere.** `useOwnerDashboard` returns `isLoading` but never `isError`. `OwnerDashboardPreviewPage` renders a skeleton then the dashboard. If `/api/owner/portfolio/summary` 500s, the owner sees **₹0 outstanding, 0/0 beds, 0% collected** — indistinguishable from a healthy empty hostel. Same omission in `TenantsPage`, `MoneyPage`, `HostelOverviewPage`.

**P2 — Refresh works; live updates do not.** Mutations invalidate the right keys (Quick Collect invalidates 5). But `broadcast()` pushes SSE events server-side (`lib/events/index.ts:25`) and **no live owner screen subscribes**. `/api/events-token` is reachable only through an unused wrapper.

#### Dead subsystem: `hostel_daily_snapshots`

`portfolioService` and `dashboardSnapshotService` are architected around a daily snapshot table. `createSnapshot()` has exactly one caller — `portfolioService.forceRefresh()` — which has **zero callers**, and there is **no snapshot cron in `render.yaml`** (10 crons registered, none of them this).

Consequence: `getSnapshotOrLive()` always misses and falls through to `previewLive()`, a live SQL aggregate, **per hostel, per dashboard load**. Numbers are correct — the caching layer simply never engages. A 10-hostel owner triggers 10 live aggregates on every Home render plus a portfolio recompute.

*Not a data bug. A performance cliff and ~400 lines of unreachable design intent.*

---

### 3.8 Search — **5%**

`GET /api/owner/search` exists. Zero live consumers.
Home's search bar: `<span>Search tenant, room..</span>` — no input, no handler (`OwnerHomeDashboard.tsx:81`).
Real search exists only *within* Tenants (client-side over the truncated 50) and Rooms (client-side over the loaded floors). No global search, no server-side search, no pagination, no debounce, no filters beyond 3 status chips.

---

### 3.9 Notifications — **5%**

| Channel | State |
|---|---|
| In-app | `GET /api/notifications`, `PATCH /api/notifications/:id/read` — **no owner UI**. `notificationService.getAll/markAsRead` never called from a live file. |
| Alerts page | 100% mock, session-local `useState`, every action `'Coming soon'` |
| Unread counts | Home bell = real derived count; Alerts chips = `mockLeads.length` etc. The two disagree by construction. |
| Reminders | `POST /api/notifications/send-reminder` + `reminder-service.ts` + `cron-rent-reminders` — **cron only, no manual send**. `ReminderActionBar.tsx` orphaned. |
| WhatsApp | Fully built (bot, DUES/PAY, owner assistant `owner-whatsapp-assistant.ts`, 7180 lines). Owner-side connection UI (`/api/owner/whatsapp/link-code`, `/connections`) has **no screen**. |
| Daily briefings | `cron-daily-briefings` → WhatsApp/email. No in-app view. |

---

### 3.10 Agreements — **0% owner UI**

No route in `OwnerRoutes.tsx`. Backend inventory that no owner can reach:

`/api/agreements/renewals`, `/api/agreements/renewals/:id` (composed read model), `/api/agreements/renewal-offers` (+`/:id`, `/:id/send`), bulk renewal campaigns (5 strategies), `/api/agreements/:id/renewal-draft`, `/sign-renewal`, `/api/agreements/history`, `/api/agreements/lifecycle-recovery` (+`/completion`, `/export`), `/api/owner/hostels/:id/agreement-template` (+`/preview`, `/signature`), `/api/owner/config/agreements/templates`, `/clauses`.

Agreements are **generated** correctly at activation and **renewed** correctly by `cron-agreement-lifecycle` — the owner simply has no window into any of it. Tenant-side renewal (`/tenant/renewal`) is live, so a tenant can receive and sign an offer the owner cannot create.

**Home's "Review Agreements" tile shows a real count and has nowhere to go.**

---

### 3.11 Complaints — **0% · dead table**

`model complaints` at `prisma/schema.prisma:104` — `title`, `description`, `category`, `status`, `priority`, `resolved_at`, `comment`, FKs to `hostels` and `tenants`.

- **Zero** route files reference it
- **Zero** services reference it
- `ComplaintsSection.tsx` exists in the frontend and is orphaned

What actually works is a *different* subsystem: `service_requests` (`/api/service-requests`, `/api/tenants/me/service-requests`), 6 request types, tenant raise → owner assign/progress/resolve/reject at `/owner/more/service-requests`, with a timeline. That flow is ~80% and real.

**Recommendation:** drop the `complaints` table, or fold it into `service_requests`. Two overlapping models for "tenant reports a problem" is exactly the kind of drift `docs/obsidian` warns about.

---

### 3.12 Analytics — **10% · real where it exists, absent where it matters**

| Surface | Verdict |
|---|---|
| Money → cashflow forecast | **Real** — per-hostel `GET /api/dashboard/cashflow` fan-out, summed |
| Money → expense category / vendor / trend | **Real** — computed server-side in `/api/expenses` |
| Money → collection rate, action queue | **Real** |
| Food → Smart Insights | **Static** — `SMART_INSIGHTS` constant in `shared/mocks/food.ts` |
| Food → Polls | **Mock** — `useState(mockFoodPolls)`, resets on reload |
| Tenant risk score | **Real** — `GET /api/tenants/:id/score`, real grade/trend/insights |
| Reports page | **Does not exist** |
| Funnel, portfolio-performance, monthly-stats, operations, stats-analytics | **Unused** — 5 live endpoints, 0 consumers |
| Admissions analytics | **Unused** — `GET /api/admissions/leads/analytics` |
| Move-out analytics | **Unused** — `GET /api/move-out/analytics` |

Nothing is *incorrect*. A lot is *absent*.

---

### 3.13 Global navigation audit

Bottom nav (`OwnerAppShell.tsx:32-36`): Home · Tenants · Money · Food · Configure — all 5 resolve. ✅

**Dead or misleading controls, complete list:**

| # | Control | File | Behaviour |
|---|---|---|---|
| 1 | Home search bar | `OwnerHomeDashboard.tsx:81` | `<span>`, no handler |
| 2 | Collect Rent hero card | `OwnerHomeDashboard.tsx:90` | chevron, no handler |
| 3–5 | Review Agreements / Activate Tenants / Fill Vacant Beds | `OwnerHomeDashboard.tsx:101-103` | no handler |
| 6 | `+ Add hostel` | `OwnerDashboardPreviewPage.tsx:56` | toast |
| 7 | Property kebab `⋮` | `OwnerDashboardPreviewPage.tsx:55` | toast |
| 8 | Property drag handles | `OwnerHomeDashboard.tsx:152` | decorative |
| 9 | `+ Add Charge` | `TenantDetailPage.tsx:264` | no handler |
| 10 | `Upload` (docs) | `TenantDetailPage.tsx:315` | no handler |
| 11 | Private-note `+` | `TenantDetailPage.tsx:213` | no handler |
| 12–19 | Comm-center icons ×8 | `TenantDetailPage.tsx:405` | `<span>` |
| 20 | `Change room` | `TenantDetailPage.tsx:345` | opens sheet with no room option |
| 21–26 | 6 Actions-sheet rows | `TenantActionsSheet.tsx:67` | toast |
| 27 | `✎ Edit room details` | `RoomSheetModal.tsx:40` | toast |
| 28–31 | 4 Alerts actions | `AlertsPage.tsx:16` | toast |
| 32–33 | More: Agreements, Properties | `MorePage.tsx:63,75` | toast |
| 34 | Settings: Tenant defaults | `MoreSettingsPage.tsx:48` | toast |
| 35–37 | About: Privacy / Terms / Licenses | `MoreAboutPage.tsx:21-23` | toast (real `/legal/*` pages exist!) |
| 38–40 | Help: 3 contact actions | `MoreHelpPage.tsx:38,50,62` | toast |
| 41–52 | 12 `/owner/config/*` routes | `ConfigRoutes.tsx` | "Not built yet" |

**52 dead interaction points on the owner surface.**

Item 35–37 is worth calling out: the Privacy/Terms pages **are built and routed** at `/legal/privacy` and `/legal/terms`. About just needs `navigate()` instead of a toast. Ten seconds of work.

---

## 4. Missing backend wiring — component → endpoint

Every row: the UI exists, the endpoint exists, the wire is missing.

| Frontend component | Should call | Today |
|---|---|---|
| `TenantDetailPage` → `+ Add Charge` | `POST /api/payments/obligations` | no handler (`CreateObligationModal` orphaned) |
| `TenantDetailPage` → Documents tab | `POST /api/tenants/:id/documents/:d/{verify,reject,message}` | read-only (`VerificationPanel` orphaned) |
| `TenantDetailPage` → Private Notes | `GET/POST/DELETE /api/tenants/:id/notes` | no handler (`PrivateNotes.tsx` orphaned) |
| `TenantDetailPage` → Change room | `POST /api/allocations/shift` | wrong sheet (`TransferRoomSheet` orphaned) |
| `TenantDetailPage` → comm icons | `tel:` / WhatsApp / `GET /api/activity` | `<span>` |
| `TenantActionsSheet` → Share Payment Link | `POST /api/payments/pay-link` | toast |
| `TenantActionsSheet` → View Receipts | `GET /api/payments/:id/receipt` | toast |
| `TenantActionsSheet` → Change Billing Frequency | `POST /api/tenants/:id/change-frequency` | toast |
| `TenantActionsSheet` → Request Change | `POST /api/change-requests` | toast (whole module orphaned) |
| `AlertsPage` → Leads | `GET /api/leads`, `/:id/convert-to-invitation` | `mockLeads` |
| `AlertsPage` → Renewals | `GET /api/agreements/renewals` | `mockRenewals` |
| `AlertsPage` → Requests | `GET /api/service-requests` | `mockRequests` |
| `AlertsPage` → Admin | `GET /api/notifications` | `mockAdminMessages` |
| `HostelDrilldownLayout` → header | `GET /api/owner/hostels` | `mockProperties` |
| `HostelTenantsPage` → list | `GET /api/tenants?hostelId=` | `mockTenants` |
| `MorePage` → profile header | `GET /api/owner/me/profile` | `mockOwnerProfile` |
| `MorePage` → Agreements / Properties rows | `/api/agreements/*`, `/api/owner/hostels` | toast |
| `MoreSettingsPage` → Tenant defaults | `GET/PATCH /api/hostels/:id/billing-defaults` | toast |
| `MoreAboutPage` → Privacy / Terms | `/legal/privacy`, `/legal/terms` (routed!) | toast |
| `RoomSheetModal` → Edit room | `PATCH /api/rooms/:id` | toast |
| `OwnerHomeDashboard` → search | `GET /api/owner/search` | `<span>` |
| `OwnerHomeDashboard` → 5 action tiles | deep links | no handler |
| `useInviteWizard` → success screen | reads `whatsapp_sent`/`email_sent`/`activation_link` from response | discards them |
| `FoodPage` → Polls | *(no backend — see §5)* | `mockFoodPolls` |
| `ConfigRoutes` ×12 | `/api/owner/config/*` | `RouteScaffold` |

---

## 5. Missing backend logic — UI exists, backend does not

Rare, which is the good news.

| UI | Missing backend |
|---|---|
| Food → **Polls** sub-tab (create poll, vote, results, winner, insights) | No table, no route, no service. The only owner UI with no backend at all. |
| Onboarding → hostel **type** (Boys/Girls/Co-Living) | No column on `hostels` |
| Onboarding → **food served** Yes/No | No column |
| Onboarding → **publish now vs draft** | `listing_status` exists but nothing writes it from onboarding |
| Tenant Detail → risk "payment rate %", "risk insight" | `/score` returns grade/trend/insights; per-tenant payment-rate is not computed |
| Home → "reminders sent" | No reminder-attribution tracking (honestly labelled in code) |

---

## 6. Dead code inventory

### 6.1 Orphaned frontend files — 107 of 382 (28%)

Computed by walking the import graph from `src/main.tsx`. Full list reproducible via the reachability script; the load-bearing ones:

**Owner tenant management (the old app, deleted from the router):**
`features/tenants/components/profile/TenantProfilePage.tsx` · `UnifiedActivityTimeline` · `RiskComplianceCard` · `DocumentsTab` · `PrivateNotes` · `ComplaintsSection` · `ExitWorkflowSection` · `CommunicationCenter` · `StickyOpsBar` · `FloatingActionMenu` · `RecentActivity` · `TenantProfileDrawer`

**Obligation & payment UI:**
`CreateObligationModal` · `CancelObligationModal` · `WaiveObligationModal` · `ObligationCard` · `ObligationHistorySheet` · `RentObligationList` · `SettlementPreview` · `FinancialActivityCard` · `FinancialHealthBanner` · `CompactFinancialStrip` · `PrimaryActionsBar` · `app/components/modals/{RecordPayment,ChangeRent,ChangeFrequency,CorrectPayment,EditInvite,AddTenant}Modal`

**Allocation / documents / actions:**
`TransferRoomSheet` · `AllocationHistoryTimeline` · `VerificationPanel` · `DocumentsHub` · `ReminderActionBar` · `TenantScoreCard` · `useTenantActions` · `useTenantProfile` · `useTenantsList` · `tenantStore`

**Whole modules:**
`features/change-management/*` (11 files — the vault calls this "the most fully-built feature") · `features/owner-actions/*` · `features/recovery/*` · `features/reports/*` · `features/activity/*` · `domains/*` (13 of 15 files)

**Also orphaned:** `app/components/ui/{tabs,dialog,drawer,sheet,dropdown-menu,card}.tsx` · `shared/performance/*` · `shared/types/*` · `services/index.ts` (root barrel — resolves the vault's open question: **it is dead**) · `lib/toast.ts` · `lib/share.ts`

**These are not to be deleted.** They are the salvage inventory for Sprints 1–3. Delete only after the corresponding journey is re-wired.

### 6.2 Unused backend surface

**Decommissioned (intentional):** 44 route files return `410` — the old subscription/plan/usage system.

**Live, owner-relevant, zero frontend consumer:**

| Group | Endpoints | Note |
|---|---|---|
| Agreements | ~15 | entire module |
| Config sub-app | ~12 | `/api/owner/config/*` |
| Bulk import | 6 | full CSV/Google-Form pipeline |
| Notifications | 4 | incl. manual reminder send |
| Dashboard analytics | 6 | funnel, performance, monthly-stats, operations, stats-analytics, stats-shell |
| Payments (unused half) | ~12 | receipts, export, waive, reconcile, pending-verification, bulk-generate, obligation history |
| Admissions/leads (owner side) | ~7 | analytics, convert-to-invitation, reserve-room, notes |
| Rooms/floors | 4 | delete room, delete floor, room overview, invite-defaults |
| Tenants lifecycle | ~10 | resend/cancel invite, reactivate, reactivation decisions, compliance action, export, verify docs |
| WhatsApp owner linking | 3 | `link-code`, `connections` |
| Owner search | 1 | |
| Finance-ops / reconciliation | ~6 | `/api/admin/finance-ops/*` |

**Unused services:** `owner-actions/*` registry (catalog built, never consulted) · `recovery` correction handlers (`PAYMENT_REFERENCE_EDIT` never exposed) · `hostel-daily-snapshot-service.createSnapshot` (no caller) · `portfolio-service.forceRefresh` (no caller)

**Unused tables:** `complaints` (§3.11) · `hostel_daily_snapshots` (never written) · four overlapping "financial issue" tables flagged unresolved in `docs/obsidian/TODO.md`

**Unused events:** SSE `broadcast()` fires on every mutation; no owner screen subscribes.

**Jobs:** 10 crons registered in `render.yaml`, 16 cron route dirs exist. `data-retention` (frozen) and `tenant-analytics` (manual) are deliberately unscheduled; 4 more return 410. **No snapshot cron** — see §3.7.

---

## 7. Prioritised issue register

### P0 — blocks production

| # | Issue | Where |
|---|---|---|
| P0-1 | Invite success screen ignores delivery result; no email collected → owner told invites were sent when nothing was delivered; `activation_link` discarded | `useInviteWizard.ts:46`, `TenantStep.tsx` |
| P0-2 | Owner cannot create a second hostel — the core SaaS premise | `OwnerDashboardPreviewPage.tsx:56` |
| P0-3 | Onboarding publish: 45 sequential non-transactional calls, partial failure leaves an unrecoverable half-hostel (duplicate-name guard blocks retry) | `useOnboardingSubmission.ts:132` |
| P0-4 | Owner cannot verify/reject KYC → tenants cannot be fully onboarded | Documents tab, orphaned `VerificationPanel` |
| P0-5 | Tenant list silently truncates at 50; propagates into Money → Collections | `useRealTenantList.ts:100` |
| P0-6 | No error state on any owner screen — API failure renders as ₹0 / empty | all live pages |

### P1 — core workflow broken

| # | Issue |
|---|---|
| P1-1 | Alerts page 100% mock; real bell badge → fake inbox |
| P1-2 | Agreements: no owner UI at all (~15 endpoints stranded) |
| P1-3 | Hostel drill-down header reads `mockProperties` → always "Hostel · —" |
| P1-4 | Hostel → Tenants sub-tab reads `mockTenants` → always empty, contradicts sibling tab |
| P1-5 | Owner cannot create/cancel/waive a charge |
| P1-6 | Receipts generated, never surfaced |
| P1-7 | Home Action Center: 5 of 6 tiles not clickable |
| P1-8 | Multi-hostel screens silently use `hostels[0]` (billing, notices, service requests) |
| P1-9 | No payment correction/reversal UI |
| P1-10 | `MorePage` header shows hardcoded fake owner name + email |
| P1-11 | Home search bar is a `<span>`; `/api/owner/search` unused |
| P1-12 | "Change room" opens a sheet with no room option |
| P1-13 | Private Notes input persists nothing; caption hardcoded |
| P1-14 | No manual reminder send; `ReminderActionBar` orphaned |

### P2 — major missing functionality

Room edit/delete · floor delete/rename · room base_rent & type never set · onboarding drops 4 fields · resend/cancel/edit invitation · reactivation decisions · bulk import UI · reports page · payment history/ledger UI · export (payments/tenants) · WhatsApp connection UI · `/owner/config/*` ×12 · obligations capped at 5 · overdue "days" shows 0/1 · Food Polls mock · lost redirect destination after login · non-atomic Add-Floor loop

### P3 — UX

Property drag handles decorative · comm-center icons non-interactive · About → Privacy/Terms toast instead of `navigate()` · no empty state for zero hostels · Help contact actions · no SSE subscription · `complaints` table cleanup · `admin` treated as owner in `useOwnerSession`

---

## 8. Sprint plan — organised by journey, not by page

### Sprint 1 — "An owner can onboard a hostel and get one tenant paying" (P0)

1. **Atomic provisioning** — `POST /api/owner/hostels/provision` (hostel + floors + rooms + `base_rent` + `default_security_deposit` in one transaction). Rewrite `submitPublish` to one call. Persist `type`, `food`, `deposit`, `publishChoice`.
2. **Honest invite** — add optional email to `TenantStep`; branch the success screen on `whatsapp_sent`/`email_sent`/`needs_email`; always show a copyable `activation_link`; add Resend/Cancel on `INVITED` rows.
3. **KYC verification** — re-mount `VerificationPanel`/`DocumentsTab` into `TenantDetailPage`'s Documents tab; wire verify/reject/message/upload.
4. **Add hostel** — reuse the provisioning endpoint behind Home's `+ Add hostel`.
5. **Pagination** — pass `limit`/`offset`; add infinite scroll + "N of M"; audit every consumer of `useRealTenantList`.
6. **Error states** — one `<QueryStateBoundary>` (loading / error+retry / empty), applied to all 19 owner routes.

*Exit:* signup → hostel → invite → tenant activates → KYC verified → rent generated → payment collected → dashboard reflects it — with no mock data and no silent failure.

### Sprint 2 — "An owner can run the month" (P1)

7. **Alerts, for real** — replace `useAlerts` with `/api/leads`, `/api/agreements/renewals`, `/api/service-requests`, `/api/notifications`; unify the badge with the page.
8. **Charges & receipts** — re-mount `CreateObligationModal`, `CancelObligationModal`, `WaiveObligationModal`, `RentObligationList`; add a Receipts view + share; wire `PrimaryActionsBar`.
9. **Agreements v1** — `/owner/agreements`: renewal queue, single offer, send, sign status. Make "Review Agreements" navigate there.
10. **Fix the drill-down** — `HostelDrilldownLayout` reads `useOwnerSession().hostels`; `HostelTenantsPage` reads `useRealTenantList` scoped to `:hostelId`. Deletes 2 mock imports.
11. **Action Center** — deep-link all 6 tiles; make the search bar a real input over `/api/owner/search`.
12. **Multi-hostel context** — one global hostel switcher in `OwnerAppShell`; remove every bare `primaryHostelId`.
13. **Corrections** — re-mount `CorrectPaymentModal` (reverse + transfer).
14. **Reminders** — re-mount `ReminderActionBar`; wire `POST /api/notifications/send-reminder`.

### Sprint 3 — "An owner configures their business" (P2)

15. Room/floor edit + delete; room type + base rent.
16. `/owner/config/*` — finance (late fees, gateway), agreements (templates, clauses), automation, notifications, account & team. 12 scaffolds → real screens over existing endpoints.
17. Bulk tenant import UI.
18. Payment history / ledger / export; tenant export.
19. Reports page over the 6 unused analytics endpoints.
20. Change billing frequency; reactivation decisions; compliance actions.
21. WhatsApp connection linking UI.

### Sprint 4 — polish & cleanup (P3)

22. Property reorder (persist), comm-center actions, About → legal links, empty states, Help actions.
23. SSE subscription for live dashboard updates.
24. **Delete the salvage inventory** — remove the ~107 orphans that Sprints 1–3 rendered redundant; drop `complaints`; either schedule a snapshot cron or delete `hostel_daily_snapshots` + `createSnapshot` + `forceRefresh`.
25. Food Polls: build the backend or remove the sub-tab.
26. Frontend architecture check: extend `scripts/check-architecture.mjs` to fail on (a) imports from `@shared/mocks` outside `shared/mocks`, (b) bare `primaryHostelId` use, (c) unreachable files.

Item 26 is the one that stops this from happening again.

---

## 9. Method & limitations

- Reachability from `src/main.tsx` via static import walk (relative + `@features`/`@shared`/`@lib`/`@context`/`@/`, incl. dynamic `import()`). Dynamic string-built specifiers would be missed; none observed.
- Backend routes enumerated from `app/api/**/route.ts` (359 files); 410-returning files counted by content match.
- Endpoint usage determined by matching `api.{get,post,…}` calls in reachable files, then narrowed to service-method call sites outside `*/api/*` wrappers — because a reachable wrapper does not mean a used method.
- **No browser session was driven and no test suite was run.** Every claim is static. Runtime-only issues (race conditions, actual WhatsApp delivery, PhonePe redirect) are out of scope.
- `docs/obsidian/` was read first per CLAUDE.md and found **stale in two material places**, both corrected above: the owner KYC step is real (ADR-038), not "three toggles"; and `app/components/views/*` is deleted, not merely orphaned.
