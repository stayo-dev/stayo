# Navigation Structure

## Public routes

| Route | Screen |
|---|---|
| `/` | Home |
| `/about` | About |
| `/facilities` | Facilities |
| `/rooms` | Rooms |
| `/gallery` | Gallery |
| `/location` | Location |
| `/contact` | Contact |
| `/rules` | Rules |
| `/pricing` | Pricing |
| `/visit/:hostelSlug` | QR admissions visitor flow |
| `/legal`, `/terms`, `/privacy` | Legal |
| `/login` | Login |
| `/activate`, `/activate/:token` | Tenant activation |
| `/complete-profile` | Tenant profile completion |

**How this works:**
1. `PublicRoutes` returns public route elements.
2. Public pages lazy-load behind a lightweight `PublicShell`.
3. Visitors can reach marketing, legal, and auth pages.
4. QR visitors can reach admissions without loading owner dashboard code.

## Route performance boundaries

| Shell | Provider scope | Heavy code excluded from initial public load |
|---|---|---|
| Public | Browser router and public query client | Auth, dashboards, tenant portal, billing, charts |
| Auth | Query client, Google OAuth, auth context | Owner routes, tenant routes, analytics |
| Owner | Query client, auth context, owner guard | Public marketing pages, tenant portal shell |
| Tenant | Query client, auth context, tenant guard | Owner dashboards, owner billing analytics |

Why this exists: route shells keep unrelated product areas out of each other’s JavaScript bundles.

**How this works:**
1. `RootProviders` only mounts the router at app startup.
2. `PublicShell` mounts a lightweight query client for public visit data.
3. `AuthRouteShell`, `OwnerProviderShell`, and `TenantProviderShell` load through `React.lazy`.
4. The browser downloads protected providers only after a matching route is visited.

## Hostel detail feature islands

| Island | Loads when | Main responsibility |
|---|---|---|
| Shell | Hostel route opens | Header, tab bar, hostel title, active tab routing |
| Overview tab | Overview is active | Dashboard stats and command-center summaries |
| Rooms tab | Rooms is active | Room list, floor actions, room forms, room overview |
| Tenants tab | Tenants is active | Active tenants, invited tenants, payment action |
| Financials tab | Financials is active | Billing control center and payment modal |
| Expenses tab | Expenses is active | Business expense KPIs, ledger, categories, vendors, add expense form |
| Move-outs tab | Move-outs is active | Move-out request preview and workflow link |

Why this exists: hostel operations are broad, so each tab becomes its own bundle and query boundary.

**How this works:**
1. `HostelDetailView` lazy-loads one active tab.
2. Tab clicks update the route path for deep links.
3. Room and expense modals load as nested async islands.
4. Inactive tabs do not mount their queries, forms, or heavy UI.
5. The expenses tab reads business-wide expense totals.

## Large List Rendering

| Pattern | Used for |
|---|---|
| Virtual rows | Payments, tenants, rent obligations, expenses |
| Fixed scroll container | Keeps long ledgers from expanding the whole page |
| Overscan rows | Preserves smooth scrolling during fast swipes |

Why this exists: hostel data can grow to hundreds or thousands of records per owner.

**How this works:**
1. List components pass row counts to TanStack Virtual.
2. The virtualizer maps scroll position to a small row window.
3. Filtering and searching update the row model without rendering every result.

## Dashboard Stability Pattern

| Pattern | Used for |
|---|---|
| Stable header height | Owner dashboard greeting |
| Layout-matched skeleton | Owner dashboard loading state |
| Lazy user-intent UI | Trends chart and owner modals |
| Deferred filter text | Property search |
| Background auth validation | Protected shell first paint |
| Idle secondary widgets | Tenant dashboard and expense intelligence |
| Non-animated hero LCP | Public homepage first viewport |
| Mobile no-blur reveal | Below-fold marketing sections |

Why this exists: mobile Core Web Vitals are sensitive to the first dashboard viewport.

**How this works:**
1. The first viewport reserves space before async data arrives.
2. Below-fold chart code waits until the trend panel opens.
3. Modal bundles wait until the related action is tapped.
4. Stored auth state lets the protected shell render while `/auth/me` validates.
5. Public hero content skips reveal wrappers so LCP text paints immediately.

## Mobile Runtime Boundaries

| Area | Boundary | Result |
|---|---|---|
| Tenant list | Window virtualizer | Large tenant sets do not mount every card. |
| Tenant dashboard | Progressive secondary data | Dues and payment action appear before documents and announcements. |
| Tenant chart | `IdleRender` plus lazy import | Recharts does not block route mount. |
| Expense tab | Ledger before intelligence | Users can inspect business expense records before analytics panels render. |
| Room tab | Memoized floor grouping | Room cards avoid regrouping work on unrelated state changes. |
| Marketing reveal | Mobile transform-only animation | Below-fold sections keep motion without blur paint cost. |
| Bottom navigation | Direct route taps | Owner and tenant sections change without swipe handlers or drag transforms. |
| Admissions CRM | Compact KPI and status tiles | Owner admissions stays scannable without oversized mobile cards. |

Why this exists: low-end Android devices feel slow when hidden work competes with visible content.

**How this works:**
1. Critical text and controls render first.
2. Lists and ledgers cap mounted rows.
3. Charts, intelligence panels, and secondary widgets wait for idle time.
4. Mobile dashboard navigation uses direct taps and immediate route changes.

## Owner routes

| Route | Screen |
|---|---|
| `/dashboard` | Portfolio |
| `/hostels/:hostelId` | Hostel detail |
| `/hostels/:hostelId/:tab` | Hostel detail tab |
| `/tenants` | Portfolio tenant entry |
| `/hostels/:hostelId/tenants` | Hostel tenants |
| `/hostels/:hostelId/tenants/:tenantId` | Tenant profile |
| `/hostels/:hostelId/move-outs` | Move-outs |
| `/alerts` | Alerts |
| `/billing` | Billing |
| `/admissions` | Admissions CRM |
| `/settings` | Settings |

**How this works:**
1. `OwnerRoutes` lazy-loads `OwnerProviderShell`.
2. `OwnerProviderShell` wraps screens in `ProtectedRoute`.
3. Hostel ID scopes workspace screens.
4. Admissions opens dashboard, pipeline, QR generator, and lead profile screens inside one route.
5. Admissions leads use owner scope and can link back to hostel rooms.

## Tenant routes

| Route | Screen |
|---|---|
| `/tenant/dashboard` | Tenant dashboard |
| `/tenant/financials` | Tenant financials |
| `/tenant/payments` | Tenant payments |
| `/tenant/room` | Tenant room |
| `/tenant/profile` | Tenant profile |
| `/tenant/move-out` | Tenant move-out |
| `/payment-return` | Payment return |

**How this works:**
1. `TenantRoutes` lazy-loads `TenantProviderShell`.
2. `TenantProviderShell` applies `ProtectedTenantRoute`.
3. Tenant pages call `/tenants/me/*` endpoints.

## Admin routes

`apps/frontend` currently returns an empty admin route fragment.
Backend admin pages exist under `apps/backend/app/(dashboard)/admin`.

**How this works:**
1. Frontend v2 does not expose admin screens.
2. Next.js backend app includes admin finance pages.
3. A rebuild must choose one admin UI location.

> **Needs clarification:** Admin navigation is split between `apps/frontend` and `apps/backend`. Confirm final admin app ownership before client rebuild.
