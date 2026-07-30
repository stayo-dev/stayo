# Hostels

## What this does

The hostels module lets owners create, view, and enter hostel records. A hostel groups rooms, tenants, rent settings, payment configuration, expenses, and operational alerts.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Hostel list | Lists all hostels for the owner | Name, address, occupancy, stats |
| Hostel detail | Shows one hostel workspace | Overview, rooms, tenants, expenses, tabs |
| Hostel identity settings | Edits public identity | Name, address, logo, phone |

## Data it needs

- `ownerService.getHostels()` from `/owner/hostels`.
- `ownerService.createHostel(data)` from `/owner/hostels`.
- `ownerService.updateHostel(data, hostelId)` from `/hostels/:id`.
- `ownerService.uploadLogo(file, hostelId)` from `/hostels/:id/logo`.

## Data it produces

- Hostel records in the `hostels` table.
- Hostel logo uploads through ImageKit or configured storage.
- Preference updates under `hostels.preferences_config`.

## Key components

- `HostelsView` renders the hostel list.
- `HostelDetailView` renders a hostel workspace.
- `HostelCard` renders one hostel summary.
- `AddHostelModal` captures hostel creation fields.
- `EditHostelSheet` edits hostel identity.
- `HostelIdentitySection` edits settings.

## Business logic in this module

- A hostel belongs to an owner through `owner_id`.
- A hostel scopes tenants, rooms, floors, obligations, payments, and settings.
- Receipt prefix, currency, timezone, rent cycle, and auto rent day live on the hostel.

## How this works (step by step)

1. The owner opens `/hostels` or `/dashboard`.
2. The UI fetches `/owner/hostels`.
3. The owner creates or selects a hostel.
4. The selected hostel ID becomes the scope for rooms, tenants, payments, and settings.
5. Backend routes enforce this scope before writing data.

## How to reuse this for a new client

- Keep hostel scoping because it protects multi-client data.
- Replace default hostel names, addresses, logos, and receipt prefixes.
- Seed at least one hostel for a single-property client.
- Confirm timezone and rent cycle before tenant import.

**How this works:**
1. Hostel ID travels through route params and API params.
2. Backend services use that ID to filter records.
3. The owner sees only data connected to the selected hostel.

