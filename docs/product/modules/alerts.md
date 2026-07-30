# Alerts

## What this does

The alerts module shows overdue dues, due-soon obligations, pending documents, and operational reminders. It gives owners a focused action list.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Alerts view | Shows action items | Overdue dues, due soon, pending documents |
| Due card | Explains one tenant due | Tenant, amount, due date, urgency |
| Pending documents | Shows compliance work | Tenant documents waiting for review |

## Data it needs

- `ownerService.getHostels()` from `/owner/hostels`.
- `paymentService.getAllDues(hostelId)` from `/payments/dues`.
- `tenantService.getPendingDocuments(hostelId)` from `/tenants/pending-documents`.
- Date helper logic inside `AlertsView`.

## Data it produces

- Navigation to record payments.
- Navigation to tenant document review.
- Reminder actions through notification services when wired.

## Key components

- `AlertsView` renders the alert dashboard.
- `DueCard` renders one due or overdue item.
- `RecordPaymentModal` resolves a due from the alert surface.

## Business logic in this module

- Overdue items compare due date with current date.
- Due-soon items compare due date against upcoming windows.
- Document alerts use active pending identity documents.

## How this works (step by step)

1. The owner opens `/alerts`.
2. The UI chooses an active hostel.
3. It fetches dues and pending documents.
4. It groups items by urgency.
5. The owner records payment or opens tenant review.

## How to reuse this for a new client

- Keep alerts as an action list, not a reporting page.
- Adjust urgency windows for the client's collection policy.
- Add client-specific alert types only after backend events exist.

**How this works:**
1. Alerts read from existing domain records.
2. They do not create separate alert truth by default.
3. The user sees operational priorities from live dues and documents.

