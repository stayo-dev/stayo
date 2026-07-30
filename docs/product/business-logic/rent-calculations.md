# Rent Calculations

## Source of truth

Rent owed is represented by `rent_obligations`.
The obligation engine creates initial obligations.
Rent generation services create recurring rent obligations.
Payments reduce obligations through allocation logic.

**How this works:**
1. A tenant invitation or rent cron creates obligations.
2. Payments attach to obligations.
3. Dashboards calculate outstanding money from obligation balances.

## Initial obligations

| Obligation | Created when | Due date |
|---|---|---|
| `RENT` | Imported active tenant or explicit create flag | Billing start date or joining date |
| `ADVANCE` | Advance deposit is greater than zero | Joining date |
| `MAINTENANCE` | One-time maintenance charge is greater than zero | Joining date |

**How this works:**
1. Invitation passes tenant, allocation, owner, hostel, and fee values.
2. `ObligationEngine` creates idempotent records.
3. Duplicate calls skip existing obligations.

## Late fees

Late fees are calculated by `apps/backend/lib/billing/engine.ts`.
Rules support flat, per-day, and percentage fees.
Grace days reduce the effective delay.
A maximum cap limits total late fees.

**How this works:**
1. The engine subtracts grace days from calendar delay.
2. Enabled rules run in `after_days` order.
3. The total payable is rent plus capped late fees.

## Billing config

| Field | Meaning |
|---|---|
| `auto_rent_day` | Day of month for recurring rent generation. |
| `due_day` | Day by which rent is due. |
| `grace_days` | Days ignored before late fees start. |
| `late_fee_rules` | Array of enabled fee rules. |
| `max_late_fee` | Maximum total late fee. |

**How this works:**
1. Settings store billing preferences.
2. Services resolve new and legacy config shapes.
3. Generated obligations use the normalized rules.

## Rebuild notes

- Store amounts as integer paise where payment precision matters.
- Keep rent generation idempotent.
- Add a unique key for allocation, month, and obligation type.
- Never let frontend-only calculations write financial records.

> **Needs clarification:** The exact production schedule for each hostel depends on stored preferences. Export live hostel preferences before a client migration.

