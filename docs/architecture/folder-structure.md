# Folder Structure

## Root folders

| Folder | Why this exists |
|---|---|
| `apps/frontend/` | Canonical future React UI. |
| `apps/backend/` | Canonical Next.js API, admin pages, Prisma schema, and services. |
| `frontend/` | Legacy active-looking SPA used as reference evidence. |
| `temp-ui/` | Figma or prototype export used as visual reference. |
| `migrations/` | Raw SQL migration and hardening history. |
| `scripts/` | Validation, branding, backup, and operational scripts. |
| `test-data/` | Test data notes for import and repair scenarios. |
| `docs/` | Learning documentation and rebuild guide. |

**How this works:**
1. Product behavior is reconstructed from `apps/frontend` and `apps/backend`.
2. Legacy folders explain older decisions when v2 code is thin.
3. SQL migrations explain database behavior not visible in Prisma alone.

## `apps/frontend/`

| Path | Why this exists |
|---|---|
| `src/app/router` | Combines public, owner, tenant, and admin routes. |
| `src/platforms/owner` | Defines protected owner routes. |
| `src/platforms/tenant` | Defines protected tenant routes. |
| `src/app/components/views` | Holds owner-facing screens. |
| `src/features/*/api` | Wraps API endpoints by feature. |
| `src/features/tenants` | Holds tenant list, profile, document, allocation, and move-out UI. |
| `src/portal` | Holds tenant portal layout, pages, and widgets. |
| `src/lib/api-client.ts` | Centralizes Axios auth, refresh, and production API URL. |
| `src/lib/queryKeys.ts` | Standardizes TanStack Query cache keys. |
| `src/shared` | Holds reusable UI and shared types. |

**How this works:**
1. A route selects a page or view.
2. The view imports feature hooks or services.
3. Shared UI keeps the visual language consistent.

## `apps/backend/`

| Path | Why this exists |
|---|---|
| `app/api` | Exposes HTTP endpoints for frontend calls and cron jobs. |
| `app/(dashboard)/admin` | Provides admin finance pages inside Next.js. |
| `lib/services` | Contains legacy and current domain services. |
| `src/services` | Contains newer domain services and payment internals. |
| `src/repositories` | Wraps lower-level database access for selected domains. |
| `prisma/schema.prisma` | Defines database models, relationships, and enums. |
| `prisma/seed.ts` | Seeds SaaS plans. |
| `lib/pdf` | Generates receipt PDFs. |
| `lib/config` | Resolves frontend and backend URLs. |
| `lib/auth*` | Handles JWT auth and edge-safe auth helpers. |

**How this works:**
1. API routes stay thin when a service exists.
2. Services hold business rules and transaction boundaries.
3. Repositories are used where a domain needs narrower data access.

## Legacy and reference trees

`frontend/` remains useful because it contains older pages for owner dashboards, room management, expenses, and onboarding.
`temp-ui/` remains useful because it has prototype components and visual patterns.

**How this works:**
1. Use `apps/frontend` for canonical screen behavior.
2. Use `frontend/` when a v2 feature wrapper points to missing or older behavior.
3. Use `temp-ui` only for design references.

> **Needs clarification:** Some v2 service calls reference endpoints that are not present under matching route paths. A rebuild should reconcile each endpoint before release.

