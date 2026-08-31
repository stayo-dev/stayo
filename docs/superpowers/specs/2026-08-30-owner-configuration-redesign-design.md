# Owner Configuration Redesign — Design

**Date:** 2026-08-30
**Status:** Awaiting review
**Related:** [[Features]], [[Business-Rules]], [[APIs]], [[Decisions]], [[Bugs]], [[TODO]]

## 1. Problem

The configuration section has not been maintained for a long time. An owner
opening it meets a progress ring, six module cards, a needs-attention list, a
quick-actions row and a search bar — everything at the same weight, with no
signal about which of it matters. Meanwhile parts of it lead nowhere.

Audited against the repo, not estimated:

| Finding | Count |
|---|---|
| Config routes under `/owner/more` | 29 |
| Pages / lines in `features/owner-more` | 25 / ~7,000 |
| Backend config endpoints with **zero callers anywhere** | 7 |
| Links pointing at routes that do not exist | 2 |
| Rows advertising settings that do not exist | 11 |
| Separate screens that are all "settings" | 3 |

### 1.1 Dead code

**Seven endpoints have no reference outside their own file** — not the
frontend, not a test, not another service:
`automation-config`, `billing-config`, `notification-config`, `payment-config`,
`receipt-config`, `security-config`, `system-config`, all under
`/api/hostels/[id]/`. They were superseded by the single `preferences` endpoint
and never removed. They still accept writes.

An eighth, `/api/owner/payout-account`, exists and works but has **no frontend
caller at all** — see §3.1.

**Two dead links:**

- `/owner/more/configuration/hostel/rooms` — the "Room configuration" row,
  which renders as *configured* with a real room and bed count, so nothing
  signals that tapping it does nothing.
- `/owner/more/payout-account` — "Check payout account", which appears **only
  when a payout has failed**. At the moment an owner is told money did not
  reach their bank, the button offering to fix it is broken.

### 1.2 Structural problems

- **Three rival settings screens.** The Configuration hub, "Account settings"
  (`MoreSettingsPage`) and "Workspace Configuration" (`MoreWorkspaceConfigPage`)
  overlap. Account settings offers "Hostel identity" and "Billing policy" —
  the *same routes* as the hub's Hostel and Finance modules.
- **Two completeness scores, computed independently.** The hub's ring comes from
  `useConfigurationHub` (per-module attention tallies); Workspace Configuration
  renders its own percentage from `useWorkspaceConfig` (done / total). Different
  inputs, different maths, no shared source. They can disagree about the same
  workspace.
- **Two sources of truth for which settings exist.** Rows come from
  `deriveConfigSections`; search comes from `configSearchIndex.ts`, a
  hand-maintained parallel list. Several search entries already land on a module
  page rather than the setting, so an owner who searched a setting by name must
  then hunt for its row.
- **The hub has two URLs.** `/owner/more` and `/owner/more/configuration` render
  the same component, so back-navigation depends on how the owner arrived.
- **Quick actions duplicate the modules beneath them**, with a `+` that reads as
  *create* when the action is *edit*.
- **"About StayO"** is user-visible on the hub and as the About screen's title.
  The product is Stayo.
- **System vocabulary.** "Workspace mostly configured", "4 of 6 modules set up",
  "7 areas". *Module*, *workspace* and *area* describe our code structure.

## 2. The fact that shapes the solution

Despite 25 pages, nearly every setting an owner changes lives in **one object** —
`HostelPolicy`, read and written through a single
`GET/PATCH /api/hostels/[id]/preferences`:

| Group | Holds |
|---|---|
| `billing` | Rent cycle, due day, grace days, late-fee rules, deposit, maintenance, invite defaults, partial payments, payment frequency |
| `payments` | UPI id, gateway merchant id, payment instructions |
| `reminders` | On/off, channels, before/after-due schedule, auto-stop, daily summary |
| `receipts` | Prefix, format, auto-email, footer |
| `branding` | Logo, GST number, legal name |
| `tenant_rules` | Profile edits, photo required, invite expiry, agreement required |
| `automation` | Auto-generate rent, auto late fees, auto reminders, auto receipts, auto-deactivate days |
| `operations` | Currency, timezone, date/time format, language — never surfaced |

Plus `HostelInfo` (name, phone, address, city, state, pincode, UPI, GST, logo).

Only four areas sit outside it: agreement templates and clauses, owner profile
and password, notices, and service requests.

**Consequence:** the sprawl is presentation, not data. No setting needs its own
page and none needs a wizard. This is what makes a 6–10 second edit reachable.

## 3. Structure

The organising axis is **what belongs to the owner** versus **what belongs to a
hostel** — a distinction the current UI does not make, and the one that decides
whether a multi-hostel owner can edit the wrong hostel by accident.

Per-hostel settings move **into the hostel**, as a new Settings tab on the
existing drilldown. The hostel is then established by navigation rather than by
a picker the owner might not notice. This mirrors, in the UI, the invariant the
backend already enforces server-side (`architectural-invariants-check.ts`:
operational code must never fall back to "first hostel").

### 3.1 Configure tab — owner-level only

**1 · You and your account**

| Row | Source |
|---|---|
| Your details — name, phone, email | `profiles` via owner profile API |
| Password and sign-in | existing auth surfaces |
| **Where your money goes** — account holder, account number, IFSC, bank | `profiles.payout_*`, `GET/PATCH /api/owner/payout-account` |
| Alerts sent to you | `reminders.owner_daily_summary` and payout alerts |

The bank account is **owner-scoped, not per-hostel** — `payout_holder_name`,
`payout_account_no`, `payout_ifsc`, `payout_bank_name` live on `profiles`
(migration 070). The model already matches the requirement; only the UI is
missing. Building this row is what makes the failed-payout alert's
"Check payout account" link work.

Row shows the masked destination (`HDFC ••••4321`) or, when unset,
"Not added — payouts are on hold", because that is the consequence the owner
cares about.

**2 · Your hostels** — one row per hostel, leading into that hostel's Settings.
A doorway, not a second place to manage them.

**3 · Help and about** — Help · About Stayo.

### 3.2 Hostel → Settings (new tab)

The drilldown gains a fifth tab beside Overview / Rooms / Tenants / Marketing.

| Section | Rows |
|---|---|
| **Hostel details** | Name, address & phone · Logo · GST & legal name |
| **Rent and payments** | When rent is due · What happens when it's late · How tenants can pay · Deposits · How they pay you · Receipts |
| **Reminders** | See what we send · Which days they go out · Channels · Stop once they've paid |
| **Bringing in a new tenant** | Default rent, deposit & agreement length · Can these be changed per tenant · What a tenant must provide · Invite valid for |
| **Agreements** | Your agreement (+ versions) · Clauses · Require signing before move-in |
| **Archive this hostel** | Moves here from Overview, with the other irreversible settings |

Hostel identity moves **out of** Configure. It is the only genuinely unique row
the old Hostel module had, and the drilldown — which owns that hostel's rooms,
marketing and tenants — could not edit its name, address, logo or GST at all.

**Automation disappears as a section.** "Auto-generate rent" belongs under
*When rent is due*; "auto late fees" under *What happens when it's late*. It is
a section today only because it is a field group in code.

## 4. Interaction

Two tiers, both measured from tapping the row to the change being saved.

**Tier 1 — one value.** An inline toggle, or tap → pick → saves and closes.
Target **3–6s**. Examples: require signing, stop reminders once paid, invite
validity.

**Tier 2 — one rule (2–4 fields that only make sense together).** Tap → sheet →
Save. Target **8–12s**. Examples: late fee (type, amount, starts after, cap),
deposit (amount or months, refundable).

Every row **states its current value in the owner's words** rather than
presenting an empty field — the same principle applied to the enquiry screen in
[[Decisions#ADR-156|ADR-156]]. A stated value is a correction to make, not a
task to complete.

**Saving is immediate, with an Undo toast.** No save bar, no dirty state, no
"unsaved changes" prompt. `SaveBar.tsx` and `Stepper.tsx` go: they exist because
settings are currently pages to fill in rather than values to correct. (See §6
on `dirtyState.ts`, which another feature depends on.)

**No completeness score, no status badges, no quick actions.** Both scores, all
11 "unavailable" rows and the quick-actions row exist to feed a progress meter.
Removing the meter removes the reason for all of them.

**Search derives from the same list that renders the rows.** One source, or it
drifts again. `configSearchIndex.ts` is deleted.

## 5. The three that need real design

### 5.1 Reminders — "See what we send"

Does not exist today in any form. A list of the actual messages, rendered as the
tenant will receive them, with the hostel's name and realistic numbers filled
in. An owner has never seen what Stayo says on their behalf.

### 5.2 Reminders — which days

**The owner picks calendar dates; the system stores offsets.** The requirement
is a 1–31 grid. The stored model is `reminders.schedule.before_due_days` /
`after_due_days` — offsets that follow *each tenant's own due date*. These are
not the same thing: with absolute dates, a tenant whose rent is due on the 10th
would receive "rent due soon" on the 20th.

The grid therefore renders against the hostel's `billing.due_day`, which is
marked on it, and each selected date is converted to an offset on save. The
owner thinks in dates; the engine stays correct per tenant.

Two grids, not one — *before rent is due* and *after it is overdue* are
different conversations.

**Open:** this mapping assumes one due day. A tenant on a quarterly or
academic-year cycle (`billing.payment_frequency.allowed_frequencies`) does not
have one. Decide whether such tenants follow the converted offsets, or whether
the grid is disabled where mixed frequencies are in use.

### 5.3 Partial payment — the soft edge

One row, three states:

1. Full payment only
2. Full only, **but tenants can ask** ← the soft edge
3. Partial allowed above ₹X

State 2 does not exist in the schema. `allow_partial` is hostel-wide only
(`src/services/payments/financial-policy.ts`); there is no per-tenant override
anywhere. It requires a per-tenant or per-obligation exception record and an
owner approval step.

**Scope:** build the setting in this work; the request → approve flow is a
separate piece with its own design. The setting must degrade honestly — state 2
is not offered until the flow behind it exists.

### 5.4 Agreement versions

Row shows "v3 · published 12 Aug". Inside, the version list, each viewable.
Publishing creates a **new version rather than overwriting**: an agreement a
tenant has already signed must never change under them. The existing
`agreement-template` endpoints already version on publish; this is a UI over
behaviour that exists.

## 6. What gets deleted

- 7 dead config endpoints under `/api/hostels/[id]/`
- `MoreSettingsPage`, `MoreWorkspaceConfigPage`, and the Configuration hub as a
  module grid
- `useWorkspaceConfig` and the hub's completeness tally
- `configSearchIndex.ts`
- `SaveBar.tsx` (and its `.stayo-save-bar` rule in `stayo-theme.css`),
  `Stepper.tsx`, `ConfigProgressRing.tsx`, `ConfigModuleCard.tsx`,
  `ConfigStatCards.tsx` — all verified to have no users outside `owner-more`

**Kept, despite belonging to the old model:** `config/dirtyState.ts`. Its
`hasChanges` is imported by `owner-food`'s `MealTimingsForm.tsx` — a real
cross-feature dependency. Either leave it in place or move it to `shared/`;
do not delete it with the rest.
- The duplicate `/owner/more` route
- All 11 "unavailable" rows
- The `/owner/more/configuration/hostel/rooms` dead link (the drilldown's Rooms
  tab already owns rooms)

`/owner/more/payout-account` stops being a dead link because §3.1 finally
provides its destination.

## 6a. Decomposition

This is too large for one implementation plan. Three pieces, in order, each
shippable and independently revertable:

**A · Remove the dead.** The 7 endpoints, the 2 dead links, the 11 unavailable
rows, the duplicate `/owner/more` route, the "About StayO" spelling. Touches no
new UI, so it can land and be verified on its own.

**B · Configure tab.** You and your account (including *Where your money goes*),
Your hostels, Help and about. Retires `MoreSettingsPage` and
`MoreWorkspaceConfigPage`. Delivers the payout-account fix, which is the one
finding with money behind it.

**C · Hostel Settings tab.** The fifth drilldown tab and its six sections,
including the reminders preview and day grid. The bulk of the work, and the part
that needs the tab-bar fix in §7.

Each piece gets its own plan. §5.3's request-to-pay-partially flow is not in any
of them.

## 7. Risks

**The drilldown tab bar will overflow.** `HostelDrilldownLayout` renders
`TABS` as `flex gap-5.5` with **no `overflow-x-auto` and no wrapping**. Four
tabs measure ~308px; adding "Settings" pushes it to ~382px, which clips off a
360px phone with no way to scroll. This is the same failure fixed on the tenant
bottom nav on 2026-08-30 ([[Bugs]]). The row must be made to fit — verified in a
browser at 320/360/390/414px — not simply appended to.

**Instant save on money settings.** Changing a late-fee rule takes effect
immediately. The Undo toast is the mitigation; obligations already generated are
not retroactively changed by a policy edit, which should be confirmed against
`lib/billing/engine.ts` during implementation.

**Deleting endpoints that still accept writes.** The 7 dead endpoints have no
callers today, but removal should land in its own commit so it can be reverted
independently of the UI work.

## 8. Out of scope

- The tenant-requests-partial-payment approval flow (§5.3) — its own design.
- Reminder behaviour for quarterly / academic-year tenants (§5.2) — needs a
  decision before the grid ships.
- `operations` (currency, timezone, date format, language) stays unsurfaced;
  no owner has asked for it and every value is correct for the Indian market.
- Notices and service requests keep their current screens; they are content, not
  configuration.
