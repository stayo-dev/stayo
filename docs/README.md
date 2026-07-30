# HMS Learning Documentation

This documentation explains the Hostel Management System for two readers.
The first reader is the original builder learning how the code works.
The second reader is a future developer rebuilding the product for another client.

**How this works:**
1. Start with architecture to understand the moving parts.
2. Read modules to connect visible screens to code paths.
3. Use data models and business logic to rebuild the domain safely.

## Reading order

1. [Architecture overview](architecture/overview.md)
2. [Tech stack](architecture/tech-stack.md)
3. [Folder structure](architecture/folder-structure.md)
4. [Data flow](architecture/data-flow.md)
5. [Schema reference](data-models/schema.md)
6. [Business logic](business-logic/rent-calculations.md)
7. [New client checklist](build-guide/new-client-checklist.md)

## Documentation rule

Any change to a feature, user flow, API behavior, data model, business rule, setup step, environment variable, or UI pattern must update the relevant file under `docs/` in the same change.
If no docs update is needed, the change must explicitly state why.

**How this works:**
1. Code changes and docs changes stay in the same commit or pull request.
2. The relevant module, business logic, schema, UI pattern, or build guide file is updated.
3. Future developers can trust these docs as the current rebuild map.

## Architecture

- [Overview](architecture/overview.md)
- [Tech stack](architecture/tech-stack.md)
- [Folder structure](architecture/folder-structure.md)
- [Data flow](architecture/data-flow.md)

## Modules

- [Portfolio](modules/portfolio.md)
- [Hostels](modules/hostels.md)
- [Tenants](modules/tenants.md)
- [Rooms](modules/rooms.md)
- [Billing](modules/billing.md)
- [Alerts](modules/alerts.md)
- [Settings](modules/settings.md)
- [Tenant portal](modules/tenant-portal.md)
- [Activation onboarding](modules/activation-onboarding.md)
- [Move outs](modules/move-outs.md)
- [Public site](modules/public-site.md)
- [Admin finance ops](modules/admin-finance-ops.md)
- [Bulk import](modules/bulk-import.md)
- [Admissions CRM](modules/admissions-crm.md)

## Domain reference

- [Schema](data-models/schema.md)
- [Enums](data-models/enums.md)
- [Rent calculations](business-logic/rent-calculations.md)
- [Occupancy rules](business-logic/occupancy-rules.md)
- [Collection pipeline](business-logic/collection-pipeline.md)
- [Notification triggers](business-logic/notification-triggers.md)

## UI and build

- [Component library](ui-patterns/component-library.md)
- [Navigation structure](ui-patterns/navigation-structure.md)
- [Color and states](ui-patterns/color-and-states.md)
- [Setup](build-guide/setup.md)
- [Environment variables](build-guide/environment-variables.md)
- [Deployment](build-guide/deployment.md)
- [New client checklist](build-guide/new-client-checklist.md)

## Support docs

- [Glossary](glossary.md)
- [Known issues](known-issues.md)

## Canonical source choice

`apps/frontend/` is the canonical future UI.
`apps/backend/` is the canonical API and data service.
`frontend/` is legacy implementation evidence.
`temp-ui/` is a Figma/prototype reference.

**How this works:**
1. Screens are documented from `apps/frontend/src`.
2. API behavior is documented from `apps/backend/app/api` and service files.
3. Database behavior is documented from `apps/backend/prisma/schema.prisma`.
