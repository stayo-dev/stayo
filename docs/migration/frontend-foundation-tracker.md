# StayO Frontend Foundation — Migration Tracker

Living checklist for everything the foundation pass deprecated-in-place rather
than deleted, plus the coexisting legacy/StayO theme files. Update this doc
whenever a dependency listed here migrates to its StayO replacement — once a
row's "Depends on" is empty, it's safe to actually delete that file.

Foundation plan: see the approved plan referenced in `docs/migration/frontend-migration-plan.md`. Nothing in this doc has been deleted — every item below still functions exactly as before.

---

## Phase 2 — Owner Journey (Landing → Login → Lead → Activation → Onboarding → Dashboard)

Built on top of the foundation below. Full details: [[Features]], [[Changelog]]. Summary of what changed in this doc's terms:

- **`/onboarding`'s auth-gating approach changed** from the Phase-1 plan (real `ProtectedRoute`, noted in the now-deleted `OnboardingRoute.tsx`) to a dedicated mock session (`features/owner-onboarding/context/MockOwnerJourneyContext.tsx`, `sessionStorage` key `stayo_mock_owner_journey`). Reason: Phase 2 was explicitly scoped to mock data/local state only, so the real `AuthContext` was never going to be populated by this flow. The real `/owner/*` tree (`OwnerProviderShell` → real `ProtectedRoute`) is untouched. **When backend integration happens**, `/onboarding` and `/get-started/dashboard` should move to the real guard and this mock context can be deleted — nothing else depends on it.
- `platforms/owner/router/OnboardingRoute.tsx` — **deleted outright**, not deprecated. It was a same-session scaffold (`RouteScaffold` placeholder only) with zero real logic and zero dependents, so the "deprecate, don't delete" policy (which protects legacy code with real logic/dependents) doesn't apply. Replaced by `features/owner-onboarding/router/OwnerJourneyRoutes.tsx`.
- `app/pages/public/HomePage.tsx` (legacy marketing homepage) — now `@deprecated`, orphaned. `/` renders `app/pages/public/LandingPage.tsx` instead. Same "Depends on: nothing, safe to delete" status as the other Phase-1-deprecated files below.
- `app/layouts/OwnerAppShell.tsx` bottom nav fixed from 6 tabs to the real 5 (`BottomNav.dc.html` has Home/Tenants/Money/Food/Configure — no "Alerts" tab; alerts is reached via the bell icon on Home). This was a Phase-1 fidelity bug, corrected while this phase was already touching the file.
- **Font-loading bug fixed**: `styles/tokens/fonts.css` used `@import url(...)` for Manrope/Inter, but nested inside `globals.css`'s import chain that `@import` is never first in the final stylesheet — invalid CSS, and browsers silently drop it (confirmed via a real dev-server request while building this phase's typography-heavy screens). Fixed the same way the legacy Playfair/Poppins fonts already avoid this: a `<link rel="stylesheet">` in `index.html` instead of a CSS `@import`. `tokens/fonts.css` now only declares the `--font-*` variables.
- **`vite.config.ts` env-loading bug fixed**: `requireApiProxyTarget()` read `process.env.HMS_API_PROXY_TARGET` directly, but Vite does not populate `process.env` from `.env`/`.env.local` files inside the config function (only `import.meta.env` in app code gets that treatment) — a correctly-filled `.env` still failed with "HMS_API_PROXY_TARGET is not set". Fixed by calling `loadEnv(mode, process.cwd(), '')` in the config and reading from its return value.
- **`LandingPage.tsx` theme-scoping bug fixed**: it rendered with the legacy Shri Adithya color palette instead of StayO's — the page was never wrapped in `<ThemeProvider theme="marketing">`, so its Tailwind color utilities (`bg-background`, `text-primary`, etc.) resolved against the unscoped legacy `:root` tokens in `theme.css` rather than the StayO tokens scoped under `[data-app-theme="marketing"]`. Every other StayO screen this phase (onboarding wizard, dashboard preview, lead/activation pages) sets its own theme scope via a layout or route wrapper; `LandingPage` is the one screen that owns its own root, and that wrap was missed. Fixed by wrapping the page's return value directly.
- **Owner entry point changed post-launch, by explicit request (round 1)**: "Get Started"/"Manage My Hostel"/"Book a demo" (now one entry point) no longer opens the email/password `LoginModal` — it opens a new `shared/ui-patterns/GoogleSignInModal.tsx` (mock-only "Continue with Google", explicitly chosen over wiring the real `@react-oauth/google` package already in the codebase, since there's no `VITE_GOOGLE_CLIENT_ID` configured). Tenant login (top nav) is unchanged, still `LoginModal`.
- **Owner entry point changed again (round 2), superseding round 1's `LeadSubmittedPage` step**: the lead-detail form (Hostel Owner Name/Hostel Name/Phone Number) moved off `LeadSubmittedPage` and into a new in-page popup, `features/owner-onboarding/components/HostelLeadModal.tsx`, chained directly after `GoogleSignInModal` on the landing page itself — no route navigation. `HostelLeadModal` is a single 3-step popup: details form → 6-digit phone OTP (mock-verified, same visual pattern as the onboarding wizard's OTP sheet) → a "Thanks, the Stayo team will reach out" confirmation with no email/activation-link mention. **This flow intentionally stops there** — it does not call `journey.activate()` or navigate into `/onboarding`, matching the real intended process (a human reviews the lead before any self-serve activation). `MockOwnerLead` gained matching optional fields (`hostelName`/`ownerName`/`phone`) and `MockOwnerJourneyContext` gained `updateLead()` in round 1, both still used by `HostelLeadModal` in round 2. `LeadSubmittedPage`/`ActivationLinkPage`/`OwnerOnboardingWizard`/`OwnerDashboardPreviewPage` and their routes are unchanged and still fully functional — just no longer reachable from the landing page's click path. If a later phase wants the two paths reconciled (e.g. a real invite email eventually deep-linking into `/get-started/activate/:token`), start there.

---

## Phase 3 — Owner App: Tenants tab (full experience)

Full details: [[Features]], [[Changelog]]. Built as production-quality frontend architecture per explicit direction (not just screens) — summary:

- **`OwnerAppShell` gained a `basePath` prop** (default `/owner`, real tree unaffected). Fixes a real bug: the mock dashboard preview already rendered inside `OwnerAppShell`, whose bottom nav was hardcoded to `/owner/*` — clicking any tab from the mock preview bounced you to `/` (no real session → real `ProtectedRoute` redirect). The mock preview now passes `basePath="/get-started"`.
- **Mock dashboard preview route renamed**: `/get-started/dashboard` → `/get-started/home` (matches the `/owner/home` naming convention the bottom nav now needs). `/get-started/dashboard` is kept as a `<Navigate>` redirect so the onboarding wizard's Success step (and anything else) that still links to the old path keeps working.
- **Mock data centralized under `shared/mocks/`, not per-feature** — `shared/mocks/dashboard.ts` (migrated from the now-deleted `features/owner-dashboard/mockDashboardData.ts`), `shared/mocks/tenants.ts` (new — one `MockTenant[]` array, `hostelId`s matching `shared/mocks/dashboard.ts`'s `mockProperties`), `shared/mocks/payments.ts` (new — payment-mode/billing-frequency constants + `computeSettlementPreview()`, deliberately simple client-side math, not the real FIFO/settlement engine). Reused across Dashboard now; Money/Food/Reports should read from these same files rather than inventing their own tenant/property data.
- **New `features/owner-tenants/` module**, mounted at `/get-started/tenants` (list) and `/get-started/tenants/:tenantId` (detail — a real route, not a modal, specifically so it can become `/owner/tenants/:tenantId` later with minimal changes: it already uses `navigate(-1)`/relative navigation, not hardcoded paths). Structure: `types.ts`, `hooks/{useTenantFilters,useInviteWizard}.ts`, `components/{TenantList,TenantRow,TenantFilters}.tsx`, `invite/InviteTenantWizard.tsx` + `invite/steps/*.tsx` (4-step: Tenant/Stay/Money/Verify), `quick-collect/QuickCollectModal.tsx` (5-step: Select/Amount/Preview/Password/Success, self-contained), `actions/TenantActionsSheet.tsx`, `pages/{TenantsPage,TenantDetailPage}.tsx`.
- **Honesty about what's wired vs. not**: in `TenantActionsSheet`, only "Receive Payment" (→ Quick Collect) is functional. The other rows (Share Payment Link, Create Charge, View Receipts, Request Change, Change Rent, Change Billing Frequency, Check-out/Exit) show a `stayoToast.info('Coming soon')` instead of silently doing nothing or pretending to work.
- Real `/owner/tenants` (`OwnerRoutes.tsx`) is **untouched**, still a `RouteScaffold` — same precedent as `/owner/home`. Every component built this pass is presentational/mock-data-driven, meant to be mounted there later with a real query hook swapped in for the mock data imports.
- Not done this pass (explicitly deferred, not oversights): real settlement/FIFO logic, backend calls, real auth, the global Quick Actions FAB (Home's "+" button isn't wired to open Invite/Quick Collect yet), Money and Food tabs (queued next).

## Phase 3b — Owner App: Hostel Drill-down (Rooms grid/layout view)

Full details: [[Features]], [[Changelog]]. Same architectural principles as Phase 3 — summary:

- **New `shared/mocks/rooms.ts`** — `Floor`/`Room`/`RoomBed` mock data, `hostelId`s matching the same `mockProperties` set. `getHostelRoomStats()` *derives* the Rooms tab's stat tiles (beds occupied, vacant rooms, reserved rooms) from the room list rather than hardcoding them separately, so they can't drift out of sync.
- **New `features/hostel-drilldown/` module**, mounted at `/get-started/hostels/:hostelId/{overview,rooms,tenants}` — the exact same path shape as the real, still-scaffolded `OwnerRoutes.tsx` routes (`/owner/hostels/:hostelId/{overview,rooms,tenants}`), so this is a close swap-in later. All three nested under `HostelDrilldownLayout` (back button, hostel name/status, 3-tab sub-nav), mounted outside `OwnerAppShell` — full-screen takeover, same treatment as `TenantDetailPage`.
- **Rooms sub-tab has two modes** (local state, not separate routes, matching the design): browse (floor-grouped room rows, search, "+ Add", bed-status dots) and layout/reorder (native HTML5 drag-and-drop to move rooms between floors — same DnD pattern already used for the Home tab's draggable property cards, not a new library). `useRoomsLayout()` owns this state.
- **`HostelTenantsPage` reuses `features/owner-tenants`'s `TenantList`/`TenantRow`** rather than duplicating tenant-row markup — same `shared/mocks/tenants.ts` data, pre-filtered by `hostelId`. Tapping a tenant goes to the same `/get-started/tenants/:tenantId` page from Phase 3.
- **Wired in**: `OwnerHomeDashboard`'s property cards had no click handler at all before this — added an `onSelectProperty?` prop (keeps the component decoupled from routing), wired by `OwnerDashboardPreviewPage` to navigate into the drill-down.
- **Scope note, stated not hidden**: `AddRoomModal`/`AddFloorModal`'s forms (and live preview text) work, but submitting just closes the modal — neither mutates the mock room list. Wiring that into `useRoomsLayout`'s state is a reasonable fast-follow, not done this pass to avoid a partial/inconsistent version.
- Real `/owner/hostels/:hostelId/*` tree untouched, still `RouteScaffold`.
- **Follow-up fix, same day**: the owner app's product-theme screens (`OwnerAppShell`, `TenantDetailPage`, `HostelDrilldownLayout`) were missing the graph-paper background grid `Stayo App.dc.html` sets on its root (`#EBDCCF` 1px lines, 52px grid — line 31 of the design source) — `LandingPage.tsx` had the marketing-theme equivalent from Phase 2 but the product-theme surfaces never got it. Added `[background-image:...] [background-size:52px_52px]` to all three; opaque cards (`bg-card`) sit on top unaffected, so it only shows through in the gaps, matching the design.

## Phase 3c — Owner App: Money tab

Full details: [[Features]], [[Changelog]]. Same architectural principles — summary:

- **New `shared/mocks/expenses.ts`** — `MockExpense[]` (7 records), `EXPENSE_CATEGORIES` (9), `PAYMENT_METHOD_OPTIONS` (6). `getExpenseInsights()` *derives* category breakdown, top vendor, largest expense, and net profit from the array — not hardcoded separately (same principle as `getHostelRoomStats`). Collections/Action Queue reuse `shared/mocks/tenants.ts` directly (filtered to `status: 'overdue'`) rather than a new dataset.
- **New `features/owner-money/` module**, mounted at the single route `/get-started/money` (replacing its `RouteScaffold`) inside the same `OwnerAppShell basePath="/get-started"` wrapper Home/Tenants use. Unlike Tenants/Hostel-Drilldown, nothing here became a separate route — Collections/Expenses are tab-switches within one screen and everything else (Add Expense, Filters, Export, Expense Detail) is a bottom-sheet overlay, matching the design's own `isPulse`/`isCollections`/`isMoneyExpenses` + modal-boolean structure exactly.
- **Reuses `features/owner-tenants`'s `QuickCollectModal`** for every "Collect" button (Action Queue and Collections rows) — not a new payment flow.
- **`TenantDueRow`/`MoneyStatTiles` shared** between Pulse and Collections/Expenses since the design reuses the identical row/tile shape in both places.
- **Scope note, stated not hidden**: Add Expense's 3-step form works and computes a correct review total, but "Save expense" just closes the modal — doesn't mutate `shared/mocks/expenses.ts`. Same for Expense Detail's Edit/Duplicate/Mark Pending/Delete (all show `stayoToast.info('Coming soon')`) and Export (`stayoToast.success` confirmation, no file generated).
- Real `/owner/money` untouched, still `RouteScaffold`.

---

## Phase 3d — Owner App: Food tab

Full details: [[Features]], [[Changelog]]. Last of the three tabs in the agreed build order (Tenants → Money → Food). Same architectural principles — summary:

- **New `shared/mocks/food.ts`** — `FOOD_SLOTS`/`FOOD_LIBRARY_SEED`/`MEAL_CATEGORY_META`/`POLL_TYPE_META` and `mockFoodPolls` (4 seeded polls), ported verbatim from the design source's own mock state. `getPollWinner()` derives the leading option from a poll's own `options` array — never hardcoded separately (same principle as `getExpenseInsights`).
- **New `features/owner-food/` module**, mounted at the single route `/get-started/food` (replacing its `RouteScaffold`) inside the same `OwnerAppShell basePath="/get-started"` wrapper. Like Money, nothing here is a full-screen route in the design — Monthly Schedule/Food Polls are a pill-switch within one screen, and Poll Results (`position:absolute;inset:0` in the design) is built as a tall `BottomSheet` rather than a new overlay primitive, since it's opened from within Food and has no real route counterpart to mirror.
- **Food Library CRUD (add/edit/delete/drag-reorder chips) and the Monthly Menu's generate/reset/swap/replace/delete are real local-state features** — the design source itself implements these with local `setState`, not a backend call, so building them as real working state here is a 1:1 match, not extra scope.
- **`saveDraft`/`publishMenu`/poll `Edit`/`useWinner` are toast-only in the design source itself** (e.g. `saveDraft = () => this.showFoodToast('Draft saved')`) — building them as toast-only here isn't a mock-scope cut, it matches the reference exactly.
- Reuses `shared/ui-patterns/BottomSheet` for all 4 sheets (Meal Action, Meal Picker, Create Poll, Poll Results) and `shared/ui-patterns/DragHandle` for every drag handle (chips, poll options) — both already anticipated food-tab reuse in their own doc comments.
- Real `/owner/food` untouched, still `RouteScaffold`. This was the last tab in the agreed build order — no further owner-app tab planned without new direction.

---

## Phase 4 — Owner Frontend Completion Pass (v1 Freeze)

Full details: [[Features]], [[Changelog]]. Closes navigation gaps found in a full audit before declaring the owner-app preview feature-complete and frozen ahead of backend integration. Same mock-data/local-state architecture — summary:

- **Returning-owner fix (`LandingPage.tsx`)**: a returning mock session (`journey.authenticated`) previously got bounced back into lead-capture instead of the dashboard, because `journey.activate()` was never called by the lead-capture flow itself (by design). `openOwnerAuth` now calls `journey.activate()` (idempotent) and navigates straight to `/get-started/home` for any authenticated session; CTA label changed to "Go to Dashboard".
- **New `shared/mocks/{alerts,more}.ts`** and **`features/owner-alerts/`**, **`features/owner-more/`**, **`features/owner-dashboard/quick-actions/`** modules — see [[Features]] for the full file list.
- **`/get-started/alerts`** — Leads/Admin/Renewals/Requests, ported from `Stayo App.dc.html`'s Alerts tab, plus an added read/unread concept the design itself doesn't have (explicit request). Reached via Home's bell icon only, same as the design (no bottom-nav icon for Alerts).
- **`/get-started/more` + `/more/{settings,billing,help,about}`** — fixes a real 404 (the bottom nav already linked to `/get-started/more`, no route existed). Settings/Billing/Agreements/Properties/Sign-out ported from the design; Help & Support and About are new, added per explicit request using the identical `ListRow`/card pattern (**not in the design source** — flagged honestly, not presented as ported). "Workspace Configuration" (which in the design links out to the entirely separate `Stayo Config.dc.html` app) is a `stayoToast.info('Coming soon')` — that surface is out of scope. Sign Out is a real action (`journey.reset()` + navigate to `/`), not a placeholder.
- **Home FAB wired** — `QuickActionsSheet` (Collect Payment / Add Tenant / Add Expense / Create Food Poll — the last one added beyond the design's 3-item modal, per explicit request) plus the "View all" Action Center sheet (`AllActionsSheet`), both reusing existing flows: `QuickCollectModal`/`InviteTenantWizard` are mounted directly at Home (same "another mount point" precedent `MoneyPage` already set), while Add Expense/Create Food Poll navigate to Money/Food with router `state` that those pages read on mount to auto-open their own existing modal — no duplicated flow logic anywhere.
- **Dead-button sweep**: bell icon, FAB, "View all", property-card kebab menu, "+ Add hostel" were all unwired before this pass — all now either perform a real action or show `stayoToast.info('Coming soon')`, matching the existing honesty-about-mock-scope pattern.
- **Desktop centering** — see the corrected note under "Known follow-up" below: there is no desktop design to extract, so `OwnerAppShell`, `TenantDetailPage`, and `HostelDrilldownLayout` now center their existing mobile layout in a bordered `max-w-[480px]` frame on `sm:`+ viewports instead. No new breakpoint/layout decisions.
- Real `/owner/*` untouched. No tenant app, no Discover marketplace, no Reports, no backend, no auth — same standing rule.

---

## Phase 5 — Tenant Activation: step-body extraction (2026-08-12)

Different in kind from Phases 2–4 above: those built the **owner** app's mock-data preview screens under `/get-started/*`. This phase finishes a real, already-backend-wired flow's `portal → platforms/tenant` extraction instead — see [[Features]] and [[Changelog]] for full detail.

- **What moved**: the tenant activation wizard's step bodies (previously all inline in `src/portal/pages/ActivateAccountPage.tsx`, 2,785 lines) into `platforms/tenant/onboarding/{ActivationPage.tsx, ActivationIntroScreen.tsx, steps/*}`. `ActivationLayout.tsx`/`ActivationProgress.tsx` (the chrome) had already moved in an earlier pass — this was the second and final slice its own doc comment had flagged as pending.
- **Redesigned to match `Stayo SaaS redesign/Stayo Onboarding.dc.html`**: a new animated intro splash (full CSS-keyframe port of the design's time-of-day sky / building / actor sprites), and a new Step 5 celebration screen before handing off the session (the legacy page navigated immediately). The five backend steps (`ACCOUNT → RULES → AGREEMENT → PROFILE → ACTIVATE`) map onto the design's five visual steps — see the [[Features]] entry for the exact mapping and the two additions beyond the design source (the rules-acknowledgement checklist, and the profile step's emergency-contact/photo fields), both backend-required and neither in the design mockup.
- **No backend change.** All business logic — OTP flows, phone validation, signature/photo upload, the profile-draft localStorage autosave, the activation-progress simulation, the post-activate Supabase session hand-off — carried over unchanged from the legacy page.
- `src/portal/pages/ActivateAccountPage.tsx` marked `@deprecated` (added to the table below) — still on the `check-architecture.mjs` allowlist, no longer referenced by any route.
- **Not verified in a live browser this session** — only `vite build` and `check:architecture` were run (both clean; the one architecture-check failure found, in `TenantHelpPage.tsx`, is pre-existing and unrelated).

---

## Deprecated architecture (marked `@deprecated`, not removed)

| File | Why deprecated | Depends on (must migrate first) |
|---|---|---|
| `src/app/App.tsx` | Orphaned — `OwnerRoutes.tsx` now renders `OwnerAppShell` instead | Nothing renders it anymore; safe to delete once its sub-components (`Sidebar.tsx`, `BottomNav.tsx`, `OwnerQuickActions.tsx`) are confirmed unused elsewhere too |
| `src/portal/TenantPortalLayout.tsx` | Orphaned — `TenantRoutes.tsx` now renders `TenantAppShell` instead | The legacy tenant portal pages it wraps (`TenantDashboardPage`, `TenantFinancialsPage`, etc. in `src/portal/pages/`) — those still exist and are frozen per CLAUDE.md, not yet migrated to real StayO tenant screens |
| `src/infrastructure/` (whole folder: `api/client.ts`, `query/client.ts`, `auth/`, `storage/`) | 0-1 real consumers — `lib/api-client.ts`/`lib/queryClient.ts` are used directly everywhere else | `infrastructure/api/client.ts` has exactly one consumer: `domains/payments/api/verify.ts` |
| `src/services/index.ts` | Zero consumers anywhere in the app | None — safe to delete once confirmed no new code starts importing it |
| `src/domains/payments/index.ts`, `tenants/index.ts`, `rooms/index.ts`, `hostels/index.ts`, `notifications/index.ts` (outer barrels) | Zero consumers — the inner `domains/*/api/*.ts` layer is what's actually used | `domains/payments/api/index.ts`, `tenants/api/index.ts`, `rooms/api/index.ts`, `hostels/api/index.ts` are depended on by 3 named legacy files: `app/pages/public/ReceiptVerificationPage.tsx`, `app/components/modals/AddTenantModal.tsx`, `app/components/modals/EditInviteModal.tsx` — migrate those 3 to StayO screens first, then this whole `domains/` layer (inner + outer) can go |
| `src/domains/complaints/index.ts`, `auth/index.ts`, `moveout/index.ts`, `analytics/index.ts` | Empty scaffolding, zero consumers | None |
| 12 unused shadcn primitives in `src/app/components/ui/`: `aspect-ratio.tsx`, `pagination.tsx`, `hover-card.tsx`, `resizable.tsx`, `navigation-menu.tsx`, `calendar.tsx`, `breadcrumb.tsx`, `menubar.tsx`, `sidebar.tsx`, `collapsible.tsx`, `context-menu.tsx`, `carousel.tsx` | Zero references anywhere in the app (confirmed by the frontend audit) | None — safe to delete outright, kept only per the deprecate-don't-delete policy |
| `src/portal/pages/ActivateAccountPage.tsx` | Orphaned (Phase 5, 2026-08-12) — `PublicRoutes.tsx`'s `/activate*`/`/invite/:token` now render `platforms/tenant/onboarding/ActivationPage.tsx` instead | Nothing renders it anymore; still on the `check-architecture.mjs` legacy-portal allowlist — safe to delete once confirmed no other file imports it |

---

## Theme coexistence

| File | Status |
|---|---|
| `src/styles/theme.css` | **Untouched.** Legacy Shri Adithya tokens (`:root`, unscoped). Still the active theme for every screen not wrapped in a StayO `ThemeProvider` (i.e. anything under the deprecated `App.tsx`/`TenantPortalLayout.tsx`, and any other not-yet-migrated legacy route). |
| `src/styles/stayo-theme.css` + `src/styles/tokens/{marketing,product,fonts}.css` | **New.** StayO tokens, scoped under `[data-app-theme="marketing"\|"product"]`. Active inside `PublicLayout`, `OwnerAppShell`, `TenantAppShell`, `ConfigShell`, and the onboarding route. |
| `src/styles/fonts.css` | **Untouched.** Legacy Playfair Display + Poppins, still used by anything reading `--font-display`/`--font-body` outside a StayO theme scope. |

**Removal condition**: `theme.css` and `fonts.css` can be deleted once every route in `AppRouter.tsx` renders inside a StayO layout (`PublicLayout`/`OwnerAppShell`/`TenantAppShell`/`ConfigShell`/an onboarding or auth shell) and the two deprecated legacy layouts above have been deleted. Until then, both theme files must stay — deleting either one early would break every screen still rendering outside a `data-app-theme` scope.

---

## Foundation-only placeholders (not "features," expected to be replaced)

Every leaf route in `OwnerRoutes.tsx`, `TenantRoutes.tsx`, and `ConfigRoutes.tsx` still renders `<RouteScaffold label="..."/>` (`src/app/components/RouteScaffold.tsx`) instead of a real screen — the real `/owner/*` tree is still all scaffolds. Only the mock-journey preview at `/get-started/*` has real screens so far: Home (Phase 2), Tenants (Phase 3), Hostel Drill-down (Phase 3b), Money (Phase 3c), Food (Phase 3d), and Alerts/More/Settings/Billing/Help/About (Phase 4) — all built as reusable presentational components against mock data, not yet wired to the real routes. With Phase 4, the owner-app preview is considered **feature-complete and frozen** ahead of backend integration — see Phase 4 above. As each real StayO screen is built for `/owner/*`, replace its `RouteScaffold` usage and remove `RouteScaffold.tsx` itself once nothing references it.

`src/app/router/PublicRoutes.tsx`'s `/` route **was modified in Phase 2** — it now renders the real `app/pages/public/LandingPage.tsx` (a single scrolling homepage per `Stayo Homepage.dc.html`) instead of the legacy multi-page `HomePage.tsx`. The rest of `PublicRoutes.tsx` (About/Facilities/Rooms/Gallery/Location/Contact/Rules/legal/pricing) is still the legacy multi-page structure, untouched — those are still content/feature decisions for a later pass. `src/app/layouts/PublicLayout.tsx` (generic nav+footer chrome, built in Phase 1) still isn't used anywhere: `LandingPage.tsx` owns its own nav/footer directly, since the design's nav has scroll-linked behavior and page-specific anchor links (`#search`, `#why`, ...) that don't generalize to other pages the way `PublicLayout` assumed. It may still be useful later for secondary marketing pages if those get rebuilt to match the StayO design.

---

## Known follow-up (flagged during this pass, not a foundation blocker)

- **Correction (Phase 4)**: the line previously here claimed `Stayo App.dc.html`/`Stayo Config.dc.html` had "85/22 unextracted `@media` rules." Verified by grep during Phase 4: **neither file has any `@media` rules at all** — `Stayo App.dc.html` is a fixed 402×874 mobile device-frame mockup (`IOSDevice` component) end to end, with zero responsive/desktop consideration in the source. There is no desktop layout to extract. `OwnerAppShell`/`TenantDetailPage`/`HostelDrilldownLayout` now center the existing mobile layout in a bordered 480px frame on `sm:`+ viewports (Phase 4) rather than attempting to extract nonexistent desktop rules. `ConfigShell` (`Stayo Config.dc.html`) is untouched and still mobile-first only, out of scope for Phase 4.
- `src/app/providers/AuthShellProviders.tsx` has its own hardcoded fallback (`GOOGLE_CLIENT_ID ... || 'YOUR_GOOGLE_CLIENT_ID_HERE'`) — same category of issue as the API URL fix in this pass, but wasn't in the approved scope. Worth the same treatment in a follow-up.
- Phase 4 added `/get-started/more/help` and `/get-started/more/about` — these have **no real-route counterpart** in `OwnerRoutes.tsx` yet (only `/owner/more`, `/owner/more/settings`, `/owner/more/billing` exist there). Add matching scaffolds when `/owner/*` gets built out for real.
