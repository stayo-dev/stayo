# Tenants

## What this does

The tenants module lets owners invite, review, search, update, reactivate, and manage tenant records. It also connects tenant profiles to rooms, payments, documents, activity, and move-out workflows.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Tenants portfolio | Lets owner choose hostel context | Hostels and tenant entry points |
| Hostel tenants | Lists tenants inside one hostel | Active, invited, move-out, overdue states |
| Tenant profile | Shows one tenant deeply | Profile, room, documents, dues, timeline |
| Document verification | Reviews ID documents | Pending, approved, rejected documents |
| Reactivation requests | Handles returning tenants | Request status and owner decision |

## Data it needs

- `tenantService.getAll(hostelId, filters)` from `/tenants`.
- `tenantService.getFull(id)` from `/tenants/:id/full`.
- `tenantService.invite(data)` from `/owners/invitations`.
- `tenantService.resendInvitation(email)` from `/tenants/resend-invitation`.
- `tenantService.cancelInvitation(id)` from `/tenants/:id/cancel-invitation`.
- `tenantService.getPendingDocuments(hostelId)` from `/tenants/pending-documents`.

## Data it produces

- `profile` records for tenant login identity.
- `tenants` records for hostel membership.
- Active `roomAllocation` records.
- Initial rent, advance, and maintenance obligations.
- Document verification decisions.
- Reactivation requests and decisions.

## Key components

- `TenantsPortfolioView` chooses tenant context.
- `TenantsHostelView` renders the hostel tenant list.
- `TenantTable` renders desktop rows.
- `TenantCardMobile` renders mobile cards.
- `TenantProfilePage` renders tenant details.
- `InviteTenantModalV2` captures invitation data.
- `VerificationPanel` manages identity document review.
- `TenantStatusBadge` renders tenant state.

## Business logic in this module

- Tenants move through statuses such as `INVITED`, `ACTIVE`, `LEFT`, `CANCELLED`, `EXPIRED`, and move-out states.
- Invitation creates profile and tenant records before activation.
- Document requirements depend on profile type.
- Room transfers must pass allocation and move-out capability checks.

## How this works (step by step)

1. The owner opens `/hostels/:hostelId/tenants`.
2. `useTenantsList` fetches tenants and dashboard counts.
3. The owner invites, filters, selects, or opens a tenant.
4. Mutations call tenant services and invalidate tenant, room, dashboard, and portfolio keys.
5. The UI refreshes with new tenant status and related financial data.

## How to reuse this for a new client

- Keep tenant invitation, activation, and allocation separation.
- Replace required document types if the client uses different compliance rules.
- Review academic fields if the client is not student-focused.
- Configure default rent, advance, maintenance, and billing frequency before invites.

**How this works:**
1. Tenant identity lives in `profile`.
2. Hostel-specific tenant state lives in `tenants`.
3. Room occupancy lives in `roomAllocation`.

