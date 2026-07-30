# Tenant Portal

## What this does

The tenant portal gives tenants a private workspace for dues, payments, profile, room details, announcements, documents, scores, and move-out requests.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Tenant dashboard | Summarizes tenant account | Hostel, dues, documents, score, priority actions |
| Tenant payments | Shows payable obligations | Dues, payment history, payment modal |
| Tenant financials | Explains rent and advance | Billing timeline, advance ledger, frequency requests |
| Tenant room | Shows room assignment | Room details and roommates |
| Tenant profile | Lets tenant edit profile | Profile fields, photo, documents |
| Tenant move-out | Starts and tracks exit | Timeline, settlement, dispute, feedback |

## Data it needs

- `tenantService.getMyProfile()` from `/tenants/me/profile`.
- `tenantService.getMyRoom()` from `/tenants/me/room`.
- `tenantService.getMyScore()` from `/tenants/me/score`.
- `tenantService.getMyAdvance()` from `/tenants/me/advance`.
- `tenantService.getMyBillingTimeline()` from `/tenants/me/billing-timeline`.
- `paymentService.getTenantHistory()` for tenant payment history.
- Move-out endpoints from `/move-out/*`.

## Data it produces

- Profile edits.
- Profile photo uploads.
- Document uploads and document messages.
- Online payment attempts.
- Move-out requests, disputes, and feedback.
- Billing frequency change requests.

## Key components

- `TenantPortalLayout` renders tenant navigation.
- `TenantDashboardPage` renders tenant home.
- `TenantPaymentsPage` renders payment entry.
- `TenantFinancialsPage` renders dues and billing frequency.
- `TenantRoomPage` renders room assignment.
- `TenantProfilePortalPage` renders editable profile.
- `TenantMoveOutPage` renders exit workflow.
- `TenantPaymentModal` starts a payment.
- `TenantScorePanel` shows behavior score.
- `TenantDocumentStatus` shows compliance state.

## Business logic in this module

- Tenant session uses `tenantUser` in local storage.
- The tenant sees only their own records through `/tenants/me/*`.
- Online payments depend on obligations and payment attempts.
- Move-out actions depend on state-machine status.

## How this works (step by step)

1. The tenant signs in or finishes activation.
2. `ProtectedTenantRoute` allows tenant portal routes.
3. Tenant pages fetch `/tenants/me/*` data.
4. The tenant pays, edits profile, uploads documents, or requests move-out.
5. Mutations invalidate tenant query keys and refresh the portal.

## How to reuse this for a new client

- Keep `/tenants/me/*` endpoints to avoid tenant ID exposure.
- Replace hostel branding, rules, and payment instructions.
- Confirm which documents tenants must upload.
- Confirm whether behavior scoring should be visible.

**How this works:**
1. Owner data is scoped by hostel.
2. Tenant data is scoped by the logged-in tenant.
3. The portal gives tenants self-service without exposing owner tools.

