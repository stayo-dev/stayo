# Stayo — API Coverage Matrix (owner-side)

**Date:** 2026-08-01 · Companion to the [Product Integration Audit](./2026-08-01-owner-product-integration-audit.md)

Which backend endpoints a live owner screen actually consumes, and which are stranded.

**Legend**
`✅` consumed by a screen reachable from `src/main.tsx` · `🟡` partially wired (endpoint hit, capability incomplete) · `❌` live endpoint, no live consumer · `👻` frontend wrapper exists but the file is orphaned · `⚰️` returns 410 (decommissioned)

**Totals:** 359 route files · 44 decommissioned (410) · **~315 live** · **~118 consumed by a live owner/tenant/admin screen (~37%)**

---

## 1. Owner API coverage

### Auth & session

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `POST /api/auth/login` | ✅ | `LoginModal` | — | Complete |
| `POST /api/auth/logout` | ✅ | More → Sign out | — | Complete |
| `GET /api/auth/me` | ✅ | `AuthContext` | — | Complete |
| `POST /api/auth/owner-signup` | ✅ | Onboarding AccountStep | — | Complete |
| `POST /api/auth/send-phone-otp` | ✅ | Onboarding, Lead modal | — | Complete |
| `POST /api/auth/verify-phone-otp` | ✅ | Onboarding, Lead modal | — | Complete |
| `POST /api/auth/confirm-identity` | ✅ | Quick Collect, Change Rent | — | Complete |
| `POST /api/auth/forgot-password` | ✅ | `/forgot-password` | — | Complete |
| `POST /api/auth/reset-password` | ✅ | `/reset-password` | — | Complete |
| `POST /api/auth/change-password` | ❌ | — | Change-password screen | **P2** |
| `GET /api/auth/activity` | ❌ | — | Login-history / security screen | P3 |
| `GET /api/auth/csrf` | ✅ | api-client bootstrap | — | Complete |

### Owner profile, hostels & config

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/owner/hostels` | ✅ | `useOwnerSession` | — | Complete |
| `POST /api/owner/hostels` | 🟡 | Onboarding publish only | **"+ Add hostel" is a toast** | **P0** |
| `GET/PATCH /api/owner/me/profile` | ✅ | `/owner/more/profile` | — | Complete |
| `GET/PATCH /api/owner/me/hostel` | ✅ | `/owner/more/hostel` | — | Complete |
| `GET/PATCH /api/owner/me/preferences` | ✅ | Settings | — | Complete |
| `GET /api/owner/me/activation` | ✅ | Workspace Config checklist | — | Complete |
| `POST/DELETE /api/owner/logo` | ✅ | Hostel identity | — | Complete |
| `GET/PATCH /api/hostels/:id/preferences` | ✅ | `/owner/more/billing` | multi-hostel picker | 🟡 **P1** |
| `GET/PATCH /api/hostels/:id/billing-defaults` | ❌ | — | Settings → **Tenant defaults** (toast) | **P1** |
| `GET /api/owner/portfolio/summary` | ✅ | Home, Money, Hostel Overview | — | Complete |
| `GET /api/owner/search` | ❌ | — | **Home search bar is a `<span>`** | **P1** |
| `POST /api/owner/kyc-documents` | ✅ | Onboarding KycStep | — | Complete |
| `GET /api/owner/activity-logs` | ❌ | — | Activity-log screen | P2 |
| `GET /api/owner/alerts` | ❌ | — | Alerts page is mock | **P1** |
| `GET /api/owner/integrity` | ❌ | — | *(no auth guard — see TODO.md)* | P3 |
| `/api/owner/config/finance` (+`/late-fees`, `/gateway`) | ❌ | `RouteScaffold` | Config sub-app | **P2** |
| `/api/owner/config/agreements` (+`/templates`, `/templates/:id`, `/clauses`) | ❌ | `RouteScaffold` | Config sub-app | **P2** |
| `/api/owner/config/hostel` | ❌ | `RouteScaffold` | Config sub-app | P2 |
| `/api/owner/config/automation` | ❌ | `RouteScaffold` | Config sub-app | P2 |
| `/api/owner/config/notifications` | ❌ | `RouteScaffold` | Config sub-app | P2 |
| `/api/owner/config/account` | ❌ | `RouteScaffold` | Config sub-app (team/roles) | **P2** |
| `GET/POST /api/owner/whatsapp/link-code` | ❌ | — | WhatsApp connection screen | P2 |
| `GET/DELETE /api/owner/whatsapp/connections(/:id)` | ❌ | — | WhatsApp connection screen | P2 |
| `GET /api/owner/billing/frequency-requests` | 👻 | — | Approve/decline queue | P2 |
| `POST /api/owner/billing/frequency-requests/:id/decision` | 👻 | — | same | P2 |

### Property structure

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/rooms?hostelId&grouped` | ✅ | Hostel → Rooms, Invite StayStep | — | Complete |
| `POST /api/rooms` | ✅ | Add Room, Add Floor, Onboarding | `base_rent`/`room_type` never sent | 🟡 **P2** |
| `PATCH /api/rooms/:id` | 🟡 | drag-to-move floor only | **"Edit room details" is a toast** | **P2** |
| `DELETE /api/rooms/:id` | ❌ | — | no delete affordance | **P2** |
| `GET /api/rooms/:id/overview` | ❌ | — | richer room sheet | P3 |
| `GET /api/rooms/:id/invite-defaults` | 👻 | — | prefill rent in invite wizard | P2 |
| `GET /api/floors?hostelId` | 🟡 | via grouped rooms | — | Complete |
| `POST /api/floors` | ✅ | Add Floor, Onboarding | — | Complete |
| `PATCH/DELETE /api/floors/:id` | ❌ | — | rename / delete floor | **P2** |
| `POST /api/allocations/shift` | ❌ | — | **"Change room" opens wrong sheet** | **P1** |
| `POST /api/allocations/:id/end`, `GET /api/allocations/tenant/:id`, `/owner-history` | 👻 | — | allocation history (component orphaned) | P2 |

### Tenants

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/tenants?hostelId` | ✅ | Tenants list, Money Collections | **no pagination — capped at 50** | 🟡 **P0** |
| `POST /api/owners/invitations` | ✅ | Invite wizard | **delivery result ignored; no email field** | 🟡 **P0** |
| `GET /api/tenants/owner/tenants/:id/overview` | ✅ | Tenant Detail | — | Complete |
| `GET /api/tenants/:id/full` | ✅ | Tenant Detail → Charges | capped at 5 server-side | 🟡 P2 |
| `GET /api/tenants/:id/score` | ✅ | Tenant Detail → Risk | — | Complete |
| `GET /api/tenants/:id/documents` | ✅ | Documents tab (read-only) | — | 🟡 |
| `POST /api/tenants/:id/documents/:d/verify` | ❌ | — | **no approve control** | **P0** |
| `POST /api/tenants/:id/documents/:d/reject` | ❌ | — | **no reject control** | **P0** |
| `POST /api/tenants/:id/documents/:d/message` | ❌ | — | no owner↔tenant doc chat | P1 |
| `POST /api/tenants/:id/documents/bulk-verify` | ❌ | — | no bulk verify | P2 |
| `GET /api/tenants/pending-documents` | ✅ | Home "Verify KYC" count | tile not clickable | 🟡 **P1** |
| `POST /api/tenants/:id/change-rent` | ✅ | Change Rent modal | — | Complete |
| `GET/POST/DELETE /api/tenants/:id/notes` | ❌ | — | **Private Notes `+` has no handler** | **P1** |
| `POST /api/tenants/:id/change-frequency` (+`/custom`) | ❌ | — | Actions sheet → toast | **P2** |
| `GET /api/tenants/:id/financial-ledger` | ❌ | — | no ledger view | **P2** |
| `GET /api/tenants/:id/financial-timeline` | ❌ | — | no timeline (component orphaned) | **P2** |
| `GET /api/tenants/:id/billing-timeline` | ❌ | — | no billing schedule view | P2 |
| `POST /api/tenants/resend-invitation` | ❌ | — | **no resend** | **P1** |
| `POST /api/tenants/:id/cancel-invitation` | ❌ | — | **no cancel** | **P1** |
| `PATCH /api/tenants/:id` (edit invitation) | ❌ | — | `EditInviteModal` orphaned | P2 |
| `POST /api/tenants/:id/reactivate` | ❌ | — | no reactivate | P2 |
| `GET /api/tenants/owner/reactivation-requests` (+`/:id/decision`) | ❌ | — | no decision queue | P2 |
| `POST /api/tenants/:id/compliance-action` | ❌ | — | no compliance actions | P2 |
| `GET /api/tenants/export` | ❌ | — | no export | P2 |
| `POST /api/tenants/:id/photo` | ❌ | — | no photo upload | P3 |
| `DELETE /api/tenants/:id` | ❌ | — | no delete | P3 |

### Payments & obligations

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/payments/quick-collect/search` | ✅ | Quick Collect step 1 | — | Complete |
| `GET /api/payments/tenant-dues` | ✅ | Quick Collect step 2 | — | Complete |
| `POST /api/payments/settlement-preview` | ✅ | Quick Collect steps 2–3 | — | Complete |
| `POST /api/payments/record-offline` | ✅ | Quick Collect step 4 | — | Complete |
| `POST /api/payments/obligations` | ❌ | — | **"+ Add Charge" has no handler** | **P1** |
| `POST /api/payments/obligations/:id/cancel` | 👻 | — | `CancelObligationModal` orphaned | **P1** |
| `POST /api/payments/obligations/:id/waive` | 👻 | — | `WaiveObligationModal` orphaned | **P1** |
| `GET /api/payments/obligations/:id/history` | 👻 | — | `ObligationHistorySheet` orphaned | P2 |
| `GET /api/payments/:id/receipt` | ❌ | — | **receipts generated, never shown** | **P1** |
| `POST /api/payments/pay-link` | ❌ (owner) | tenant-side only | Actions sheet → toast | **P1** |
| `GET /api/payments` (history) | ❌ | — | no owner payment history | **P2** |
| `GET /api/payments/:id` | ❌ | — | no payment detail | P2 |
| `GET /api/payments/export` | ❌ | — | no export | P2 |
| `POST /api/payments/bulk-generate` | ❌ | — | no bulk charge creation | P2 |
| `POST /api/rent/generate` | ❌ | cron only | no manual generate/preview | **P2** |
| `GET /api/payments/pending-verification` | ❌ | — | no UPI-reference verification queue | **P2** |
| `POST /api/payments/manual-confirm` | ❌ | — | same | P2 |
| `POST /api/payments/reconcile` | ❌ | — | no reconciliation screen | P2 |
| `GET /api/payments/attempts/:id` | ❌ | — | no attempt inspector | P3 |
| `POST /api/recovery/cases` (+`/validate`, `/execute`) | 👻 | — | **`CorrectPaymentModal` orphaned — no reversal/transfer** | **P1** |

### Agreements — **entire module stranded**

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/agreements/renewals` | ✅ *(count only)* | Home "Review Agreements" tile | **tile not clickable, no queue screen** | **P1** |
| `GET /api/agreements/renewals/:id` | ❌ | — | renewal workspace | **P1** |
| `GET/POST /api/agreements/renewal-offers` | ❌ | — | offer creation | **P1** |
| `PATCH /api/agreements/renewal-offers/:id` | ❌ | — | revise offer | **P1** |
| `POST /api/agreements/renewal-offers/:id/send` | ❌ | — | send offer | **P1** |
| `POST /api/agreements/:id/renewal-draft` | ❌ | — | draft | P2 |
| `POST /api/agreements/:id/renewal-offer` | ❌ | — | single offer | P2 |
| `GET /api/agreements/history` | ❌ | — | agreement history | P2 |
| `GET /api/agreements/lifecycle-recovery` (+`/completion`, `/export`, `/:id`) | ❌ | — | recovery checklist | P2 |
| `GET/PUT /api/owner/hostels/:id/agreement-template` (+`/preview`, `/signature`) | ❌ | — | template editor | **P2** |
| `POST /api/agreements/:id/sign-renewal` | ❌ (owner) | tenant-side ✅ | owner counter-sign | P2 |

*Tenant-side renewal (`/tenant/renewal`) is fully live — a tenant can act on an offer the owner has no way to create.*

### Move-out

| API | Used | Screen | Status |
|---|---|---|---|
| `GET /api/move-out/requests` | ✅ | `MoveOutSheet` | Complete |
| `GET /api/move-out/requests/:id` | ✅ | `MoveOutSheet` | Complete |
| `POST /api/move-out/requests` | ✅ | submit | Complete |
| `POST .../:id/inspect` · `/reject` · `/settle` · `/vacate` · `/complete` · `/cancel` | ✅ | `MoveOutSheet` | Complete |
| `POST .../:id/dispute` · `/feedback` | 👻 | — | P2 |
| `GET /api/move-out/analytics` | ❌ | — | P3 |

### Expenses

| API | Used | Screen | Status |
|---|---|---|---|
| `GET /api/expenses` | ✅ | Money → Expenses | Complete |
| `POST /api/expenses` | ✅ | Add Expense wizard | Complete |
| `PATCH/DELETE /api/expenses/:id` | ✅ | Expense detail | Complete |
| `GET /api/expenses/export` | ✅ | Export modal | Complete |

### Dashboard & analytics

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/dashboard/cashflow` | ✅ | Money → forecast | — | Complete |
| `GET /api/dashboard/stats` · `/summary` · `/stats-shell` · `/portfolio-shell` | ❌ | — | superseded by portfolio/summary | P3 |
| `GET /api/dashboard/funnel` | ❌ | — | no funnel view | P2 |
| `GET /api/dashboard/portfolio-performance` | ❌ | — | no performance view | P2 |
| `GET /api/dashboard/monthly-stats` | ❌ | — | no monthly report | P2 |
| `GET /api/dashboard/operations` | ❌ | — | no ops view | P2 |
| `GET /api/dashboard/stats-analytics` | ❌ | — | **no Reports page at all** | **P2** |
| `GET /api/dashboard/tenants` | ❌ | — | — | P3 |

### Notifications

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/notifications` | ❌ (owner) | admin only | **Alerts page is mock** | **P1** |
| `PATCH /api/notifications/:id/read` | ❌ | — | mark-read is local state | **P1** |
| `POST /api/notifications/send-reminder` | ❌ | — | **no manual reminder** | **P1** |
| `POST /api/notifications/test-reminder` | ❌ | — | — | P3 |
| `GET /api/events-token` (SSE) | ❌ | — | no live updates | P2 |

### Leads / admissions (owner side)

| API | Used | Screen | Missing UI | Status |
|---|---|---|---|---|
| `GET /api/leads` | ❌ | — | **Alerts → Leads is mock** | **P1** |
| `GET/PATCH /api/leads/:id` | ❌ | — | lead detail | P1 |
| `POST /api/leads/:id/convert-to-invitation` | ❌ | — | **the lead→tenant bridge** | **P1** |
| `POST /api/leads/:id/reserve-room` | ❌ | — | room reservation | P2 |
| `POST /api/leads/:id/notes` | ❌ | — | lead notes | P2 |
| `GET /api/admissions/leads` (+`/analytics`) | ❌ | — | CRM screen | P2 |
| `GET /api/visit/:slug` (+`/leads`, `/activities`) | ✅ | public `/visit/:slug` | — | Complete |
| `POST /api/leads/self-serve` | ✅ | landing lead modal | — | Complete |
| `GET /api/leads/invitation/:token` (+`/complete`) | ✅ | `/owner-invite/:token` | — | Complete |

### Bulk import — full module, zero UI

| API | Used | Missing UI | Status |
|---|---|---|---|
| `POST /api/bulk-import/upload` · `GET /template` · `GET /:id` · `POST /:id/confirm` · `POST /revalidate` · `GET /google-form-prompt` | ❌ ×6 | import screen | **P2** |

### Food

| API | Used | Screen | Status |
|---|---|---|---|
| `GET/POST/PATCH/DELETE /api/food/menu-items(/:id)` | ✅ | Food → Library | Complete |
| `GET/POST /api/food/voting-periods` (+`/:id/close`, `/:id/results`) | ✅ | Food → Voting | Complete |
| `POST /api/food/schedules/generate` · `GET /schedules` · `/history` · `PATCH /:id/meals/:m` · `POST /:id/publish` | ✅ | Food → Schedule | Complete |
| `/api/food/tenant/*` ×4 | ✅ | `/tenant/food` | Complete |
| **Food Polls** | — | Food → Polls | ❌ **no backend exists** |

### Hostel content & service requests

| API | Used | Screen | Status |
|---|---|---|---|
| `GET/POST/DELETE /api/announcements(/:id)` | ✅ | `/owner/more/notices` | 🟡 primary hostel only |
| `GET/POST/DELETE /api/hostel-events(/:id)` | ✅ | `/owner/more/notices` | 🟡 primary hostel only |
| `GET /api/service-requests` · `PATCH /:id/status` | ✅ | `/owner/more/service-requests` | 🟡 primary hostel only |
| **complaints** | — | — | ⚰️ **table exists, no route, no service, no UI** |

### Decommissioned

44 route files return `410` — the multi-hostel subscription / plan / add-on / usage-quota system (ADR-006 "single-business migration"). Do not build against these.

---

## 2. Screen audit

| Screen | Complete | Backend connected | Production ready | Missing work |
|---|---|---|---|---|
| `/owner/home` | 80% | ✅ real | ⚠️ | 5 dead action tiles, dead search bar, "+ Add hostel" toast, no error state, decorative drag handles |
| `/owner/tenants` | 75% | ✅ real | ⚠️ | 50-row cap, no pagination, no error state |
| `/owner/tenants/:id` | 55% | ✅ read real | ❌ | Add Charge / Upload / Notes dead; no KYC verify; Change room wrong sheet; 8 dead comm icons; fake "overdue days"; 5-obligation cap |
| `/owner/money` | 85% | ✅ real | ⚠️ | inherits 50-row cap; no error state |
| `/owner/food` | 65% | 🟡 half | ⚠️ | Polls sub-tab 100% mock; Smart Insights static |
| `/owner/alerts` | 10% | ❌ mock | ❌ | **entire page: 4 mock feeds, 4 toast actions** |
| `/owner/more` | 40% | ❌ mock header | ❌ | fake owner name/email; Agreements + Properties rows toast |
| `/owner/more/settings` | 80% | ✅ nav real | ⚠️ | Tenant defaults toast |
| `/owner/more/billing` | 70% | ✅ real | ⚠️ | primary hostel only; late-fee flat rule only |
| `/owner/more/profile` | 90% | ✅ real | ✅ | — |
| `/owner/more/hostel` | 85% | ✅ real | ✅ | single hostel only |
| `/owner/more/notices` | 85% | ✅ real | ⚠️ | primary hostel only |
| `/owner/more/service-requests` | 80% | ✅ real | ⚠️ | primary hostel only |
| `/owner/more/workspace-configuration` | 90% | ✅ real | ✅ | — |
| `/owner/more/help` | 30% | static | ❌ | 3 toast actions |
| `/owner/more/about` | 40% | static | ❌ | Privacy/Terms toast **though the pages exist** |
| `/owner/hostels/:id/overview` | 85% | ✅ real | ⚠️ | no error state |
| `/owner/hostels/:id/rooms` | 70% | ✅ real | ⚠️ | no room edit/delete, no floor delete, ₹0 rent |
| `/owner/hostels/:id/tenants` | 5% | ❌ mock | ❌ | **always empty — UUID vs `'p1'` mismatch** |
| Hostel drill-down header | 20% | ❌ mock | ❌ | always renders "Hostel · —" |
| `/onboarding` (12 steps) | 70% | ✅ real | ⚠️ | non-atomic publish, 4 fields dropped, no rent on rooms |
| `/owner/config/*` ×12 | 0% | ❌ | ❌ | `RouteScaffold` |

---

## 3. Flow audit

| Flow | Status | Missing step | Priority |
|---|---|---|---|
| Owner signup → session | ✅ Complete | — | — |
| Onboarding → hostel + floors + rooms | ⚠️ Partial | atomic transaction; persist type/food/deposit/draft; room base_rent | **P0** |
| Add a second hostel | ❌ Broken | no entry point at all | **P0** |
| Invite tenant | ⚠️ Partial | delivery result ignored; no email; no activation link shown | **P0** |
| Tenant accepts → activates | ✅ Complete | — | — |
| KYC upload → **owner verifies** | ❌ Broken | verify / reject / message controls | **P0** |
| Agreement generated at activation | ✅ Complete | — | — |
| **Owner manages agreements** | ❌ Missing | whole module — no route | **P1** |
| Room allocation at invite | ✅ Complete | — | — |
| **Change tenant's room** | ❌ Broken | "Change room" opens sheet with no room option | **P1** |
| Move-in → obligations generated | ✅ Complete | — | — |
| Monthly rent generation | ✅ (cron) | no manual trigger/preview UI | P2 |
| Collect payment (full/partial/advance) | ✅ Complete | — | — |
| **Owner sees the receipt** | ❌ Broken | generated, never surfaced | **P1** |
| **Create an ad-hoc charge** | ❌ Missing | `+ Add Charge` has no handler | **P1** |
| **Cancel / waive an obligation** | ❌ Missing | both modals orphaned | **P1** |
| **Correct a wrong payment** | ❌ Missing | `CorrectPaymentModal` orphaned | **P1** |
| Overdue visibility | ⚠️ Partial | Home tile not clickable; list capped at 50 | **P1** |
| **Send a reminder manually** | ❌ Missing | cron-only | **P1** |
| Renewal offer → tenant signs | ⚠️ One-sided | tenant side live, owner side absent | **P1** |
| Move-out → settlement → vacancy | ✅ Complete | — | — |
| Vacancy reflected on dashboard | ✅ Complete | — | — |
| **Alerts / notifications inbox** | ❌ Broken | 100% mock | **P1** |
| **Lead → tenant conversion** | ❌ Missing | `convert-to-invitation` unused; Leads tab mock | **P1** |
| **Global search** | ❌ Missing | endpoint unused, bar is a `<span>` | **P1** |
| Tenant service requests | ✅ Complete | primary-hostel scoping | P2 |
| Food voting → schedule → publish | ✅ Complete | — | — |
| Food polls | ❌ Mock | no backend | P3 |
| Expenses CRUD + export | ✅ Complete | — | — |
| **Bulk tenant import** | ❌ Missing | no UI for a 6-endpoint module | P2 |
| **Reports / analytics** | ❌ Missing | no page; 6 endpoints unused | P2 |
| **Workspace configuration** | ❌ Missing | 12 scaffolds | P2 |
| Multi-hostel context switching | ⚠️ Partial | only in Tenants; 3 screens hardcode `hostels[0]` | **P1** |
