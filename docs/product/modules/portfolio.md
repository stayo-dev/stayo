# Portfolio

## What this does

The portfolio module gives an owner a top-level view across hostels. It shows performance, dues, hostel cards, and quick actions before the owner enters a single hostel workspace.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Portfolio dashboard | Summarizes multi-hostel health | Performance, dues, revenue, hostel cards |
| Hostel performance cards | Compares hostels | Occupancy, collections, active tenants |
| Revenue chart | Shows trend over months | Monthly portfolio performance |
| Quick actions | Starts common tasks | Add tenant, add hostel, record payment |

## Data it needs

- `ownerService.getHostels()` from `/owner/hostels`.
- Portfolio query keys from `queryKeys.portfolio.performance(6)`.
- Payment dues from `paymentService.getAllDues(firstHostelId)`.
- Auth state from `ProtectedRoute`.

## Data it produces

- Navigation to hostel workspaces.
- Add-hostel mutations through `ownerService.createHostel`.
- Modal actions that invalidate owner and portfolio query keys.

## Key components

- `PortfolioView` renders the owner landing dashboard.
- `HostelPerformanceCard` renders one hostel performance summary.
- `PortfolioRevenueChart` renders revenue trend data.
- `HostelCard` renders a navigable hostel card.
- `OwnerQuickActions` renders common owner actions.
- `AddHostelModal` creates a hostel.

## Business logic in this module

- Portfolio cards depend on backend summary calculations.
- The first hostel is used for due previews when a portfolio-wide dues query is not available.
- Query keys keep portfolio data separate from hostel-specific data.

## How this works (step by step)

1. The owner opens `/dashboard`.
2. `OwnerRoutes` allows owners and admins through `ProtectedRoute`.
3. `PortfolioView` requests portfolio performance and hostels.
4. The view renders hostel summaries and revenue charts.
5. The owner selects a hostel and moves into `/hostels/:hostelId`.

## How to reuse this for a new client

- Keep the portfolio pattern for multi-property owners.
- Replace hardcoded brand labels and production domains.
- Configure portfolio charts around the client's preferred KPIs.
- Confirm whether a single-hostel client should bypass this screen.

**How this works:**
1. The portfolio screen aggregates many hostel records.
2. Each hostel card links into the focused workspace.
3. The owner sees one decision page before detailed operations.

