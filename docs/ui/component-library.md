# Component Library

## Component groups

| Group | Examples | Why this exists |
|---|---|---|
| App shell | `Sidebar`, `BottomNav`, `TenantPortalLayout` | Provides role-specific navigation. |
| Cards | `StatCard`, `HostelCard`, `HostelPerformanceCard` | Summarizes operational data. |
| Tables | `TenantTable`, `PaymentLedger` | Supports dense owner workflows. |
| Mobile cards | `TenantCardMobile` | Keeps tenant lists usable on phones. |
| Modals | `AddTenantModal`, `RecordPaymentModal`, `AddHostelModal` | Captures focused create or update actions. |
| Sheets and drawers | `TransferRoomSheet`, `PaymentDetailDrawer`, `TenantProfileDrawer` | Shows detail without leaving context. |
| Status badges | `TenantStatusBadge`, payment status badges | Makes state scan-friendly. |
| Charts | `PortfolioRevenueChart`, billing charts | Explains trends visually. |

**How this works:**
1. Views compose reusable components.
2. Components receive normalized data through props.
3. Shared styling keeps owner and tenant screens coherent.

## UI primitive layer

`apps/frontend/src/app/components/ui` contains shadcn/Radix-style primitives.
These include buttons, cards, dialogs, sheets, select, tabs, tables, tooltip, and form controls.

**How this works:**
1. Primitive components wrap accessible base behavior.
2. Feature components compose primitives.
3. Pages avoid duplicating low-level UI code.

## Rebuild patterns

- Use cards for repeated items and summaries.
- Use tables for owner operations with many rows.
- Use drawers for record detail.
- Use modals for short create or confirm tasks.
- Use badges for statuses.
- Use charts only where trend data exists.

**How this works:**
1. The workflow type decides the component type.
2. Data density controls whether cards or tables fit.
3. Status and action placement stays predictable.

