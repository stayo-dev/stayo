# Frontend V2 Architecture Stabilization

## Updated Structure

The codebase now has migration-safe roots for the next architecture phase:

- `src/platforms` for role-specific routing and page composition.
- `src/domains` for business domains.
- `src/shared` for generic UI, types, hooks, layouts, and utilities.
- `src/infrastructure` for API, query, auth, and storage adapters.
- `src/app/router` and `src/app/providers` for application composition.
- Empty target folders are tracked with lightweight `.gitkeep` markers so the
  migration shape survives checkout/CI.

Existing `src/app`, `src/features`, and `src/portal` code remains in place for
compatibility. This is a controlled evolution, not a rewrite.

## Files Moved

No stable business files were physically moved in this pass. Route ownership was
introduced through new wrappers:

- `src/platforms/owner/router/OwnerRoutes.tsx`
- `src/platforms/tenant/router/TenantRoutes.tsx`
- `src/platforms/admin/router/AdminRoutes.tsx`
- `src/app/router/AppRouter.tsx`
- `src/app/router/PublicRoutes.tsx`
- `src/app/Router.tsx` now re-exports the composed router for compatibility.

## Files Marked Legacy

- `src/portal/README.md` marks `src/portal` as frozen.
- `src/features/*` remains a compatibility layer. New business code should use
  `src/domains/*` wrappers once available.
- `src/styles/index.css` and `src/styles/tailwind.css` are compatibility
  forwarding files. New code should import `src/styles/globals.css`.

## Boundary Rules Enforced

`npm run check:architecture` enforces:

- No direct `fetch()` or `axios` in `src/app`, `src/platforms`, or `src/shared/ui`.
- No new files under frozen `src/portal` unless the allowlist is intentionally updated.
- `src/shared` must not import app, platform, portal, feature, domain, or service code.

Current exception: `src/shared/ui/index.ts` is a temporary compatibility bridge
over existing shadcn primitives in `src/app/components/ui`. Primitive-group
entrypoints also exist under `src/shared/ui/buttons`, `inputs`, `cards`,
`modals`, `tables`, `sheets`, `tabs`, `charts`, `stat-cards`, and `mobile-nav`.

## Domain Normalization

Standard domain folders were created for:

- payments
- tenants
- rooms
- hostels
- notifications

Low-risk API wrappers now point to the existing feature services, avoiding
business logic movement during this phase.

## Router Decomposition Report

The monolithic router has been split by route ownership:

- Public routes: login, activation, onboarding completion, legal, pricing.
- Owner routes: dashboard, hostels, tenants, alerts, billing, settings.
- Tenant routes: payment return and tenant portal pages.
- Admin routes: placeholder only; no route behavior changed.

Deep links and auth guards are preserved.

## CSS Consolidation Report

`globals.css` is now the single active CSS entry point imported by `main.tsx`.
It owns Tailwind, animation, and theme imports. `theme.css` remains as the
token/base-layer file. `index.css` and `tailwind.css` are compatibility
forwarders only. `fonts.css` is empty and can be removed later after confirming
no deployment references it directly.

## Risk Report

- `src/shared/ui/index.ts` still re-exports from `src/app/components/ui`; this
  is intentional to avoid a risky component move.
- `src/portal` is still physically present and large; route ownership moved but
  page implementation did not.
- Existing feature APIs are JavaScript and loosely typed.
- `HostelDetailView.tsx` remains a giant component and should be decomposed
  gradually behind stable route seams.
- Tenant portal hooks perform many parallel queries and manual refetches; cache
  keys and derived models need normalization later.

## Performance And Scalability Findings

- Route bundle bloat remains visible in Vite build warnings.
- `HostelDetailView.tsx` and tenant portal pages are likely rerender hotspots.
- `features/tenant-portal/hooks/useTenantDashboard.ts` refetches many queries
  together; this should move toward a domain model with query-key invalidation.
- UI components still import directly from legacy app primitives in places.
- Some domains have API bindings but no hooks/model layer yet.

## Roadmap

1. Move shadcn primitives from `src/app/components/ui` into `src/shared/ui`
   with compatibility re-exports from the old path.
2. Move tenant portal pages one-by-one into `src/platforms/tenant/pages`.
3. Convert JavaScript feature APIs into typed domain APIs.
4. Extract domain hooks for payments, tenants, rooms, hostels, and notifications.
5. Decompose `HostelDetailView.tsx` into tab-level route components.
6. Remove `src/styles/index.css`, `src/styles/tailwind.css`, and `fonts.css`
   once imports are confirmed clean.
7. Add route-level lazy loading after route ownership stabilizes.
