# Color And States

## Semantic states

| State | Meaning | UI pattern |
|---|---|---|
| Loading | Data request is pending | Skeleton, spinner, muted placeholder |
| Empty | Request succeeded with no records | Empty-state copy and primary action |
| Error | Request failed | Retry action and error message |
| Success | Operation completed | Toast, badge, refreshed data |
| Warning | Needs owner attention | Amber or yellow accents |
| Danger | High-risk or destructive state | Red accents and confirmation |

**How this works:**
1. TanStack Query exposes loading and error state.
2. Components map data state to visual state.
3. Users see what to do next.

## Status colors

| Domain | Examples | Intended color meaning |
|---|---|---|
| Tenant | Active, invited, left | Green, blue, gray |
| Payments | Paid, pending, overdue, failed | Green, amber, red |
| Documents | Verified, pending, rejected | Green, amber, red |
| Move-out | Requested, disputed, completed | Blue, amber, green |
| Risk | Healthy, watch, urgent | Green, amber, red |

**How this works:**
1. Status badges convert raw status strings into visual labels.
2. Finance and alert screens use urgency colors.
3. Owners can scan without reading every field.

## Branding

The current product includes Sri Adithya names, domains, email addresses, and public-page colors.
These must change for a new client.

**How this works:**
1. Public pages and legal content set client identity.
2. App shell repeats brand names in navigation and login.
3. Receipt and email templates repeat the same identity.

> **Needs clarification:** A centralized theme token file exists, but not every hardcoded color or brand string is tokenized.

