# Configuration hub redesign — Slice 1: Hub, Hostel, Finance

**Date:** 2026-08-08
**Branch:** `feat/config-hub-hostel-finance`
**Status:** approved, implementing

## Context

The user supplied nine mockups (three hub screens, six module-detail screens) and asked for the existing configuration UI to match them and be wired to the backend.

An audit came first, because the previous phase of this same work had already recorded that most of the mockup had no backing data. Two of those recorded claims turned out to be **stale** and two new gaps turned up that the mockups hide.

### What the audit found

Already built, at `/owner/more/configuration`: the progress ring, ⌘K search overlay, needs-attention feed, module cards, quick-action chips and the Advanced collapsible — via `MoreConfigurationHubPage.tsx` + `useConfigurationHub.ts` (112 lines) and `components/{ConfigProgressRing,ConfigModuleCard,ConfigAttentionRow,ConfigSearchOverlay}.tsx`. Only **Hostel** and **Finance** modules shipped.

Corrections to `docs/obsidian/Features.md`, which claimed these did not exist:

- **`AgreementTemplate` exists** (`prisma/schema.prisma:2069`) with `status TemplateStatus @default(DRAFT)`, `version_number`, `published_at`, `published_by_id`. So "6 documents · 3 in draft" and "32 versions tracked" are real.
- **`hostels.gst_number` exists** (`:231`) — already wired into the hub's attention feed.

Confirmed absent (zero schema matches): clause library, dynamic/template variables, e-signature or Aadhaar anything, backup codes, 2FA/MFA/TOTP. Confirmed absent in code: any SMS provider (no Twilio, no `sendSms`). `Role` is only `OWNER | TENANT | ADMIN` — there is **no team/staff concept**, so "TEAM · 4 MEMBERS" with Owner/Manager/Staff badges has nothing behind it.

Also absent, inside screens that looked safe: no room-type model ("14 room types"), no amenities field ("12 amenities listed"), no advance-payment policy field, and `payment_method` exists only on payment *rows* — not as configuration. There is no per-owner payment-gateway record; only a stale `hostels.phonepe_merchant_id`, and `CLAUDE.md` states PhonePe references are stale with Razorpay the only implemented provider.

Confirmed present and usable: `branding` is a valid policy domain (`hostel-policy-service.ts:189`), 16 real cron jobs exist under `app/api/cron/`, `activity_logs` exists and is already written by `activity.service.ts` and `move-out-service.ts`, and `floors` is a real model.

### Decomposition

~25 of ~39 mockup rows are wireable. The rest need five independent subsystems — team & roles, 2FA + backup codes, clause library + variables, e-signature, SMS — each its own project. Specing all six screens together would produce a plan that is half implementation and half wishful thinking.

Agreed order: **(1) Hub + Hostel + Finance** ← this spec, (2) Automation (9 of 10 rows real), (3) Agreements (Templates + Version history only), (4) Account (profile, business info, sessions), (5) the missing subsystems individually.

## Decisions

1. **Real numbers only.** Same layout and pills as the mockups, but every count reflects actual data. Automation will read "4 workflows", not "9".
2. **Rows with no backing data render disabled, labelled "Not available yet"** — preserving the mockups' visual rhythm and signalling the roadmap, rather than being omitted.
3. **Disabled rows are excluded from every count** — not from "areas configured", not from "need attention", not from the hub's progress ring. Otherwise the percentage measures vapour. This is the load-bearing rule of the whole design.
4. **Recent Changes gets a real write path**, reusing `activity_logs` via the existing `ActivityService` (no migration).
5. **Account & Team ships later and without 2FA or members** — the pill cannot be made truthful.
6. **One route tree.** Keep `/owner/more/configuration`; delete the parallel `/owner/config/*` scaffold.

## Design

### Shared components

Built for reuse, since slices 2–4 need the same shapes:

- `ConfigScreenHeader` — back chevron + "Configuration" breadcrumb, large title, subtitle.
- `ConfigStatCards` — the green "*N* areas configured" / amber "*N* need attention" pair.
- `ConfigSectionGroup` — uppercase section label + rounded card wrapping rows.
- `ConfigSettingRow` — status dot (green configured, amber attention, grey off/not-required), title, sub-line, optional chevron; plus a `disabled` variant that renders "Not available yet" and is not tappable.

### Hostel screen — "Your physical property setup"

| Section | Row | Source |
|---|---|---|
| Identity & brand | Hostel identity | name/phone/address completeness + real property count |
| | Branding | `policy.branding` (logo, colours) |
| | Receipt branding | `policy.receipts` header |
| Property | Property details | hostel city + `floors` count |
| | Room configuration | real room count + summed bed capacity |
| | Room types | **disabled** — no room-type model |
| | Amenities | **disabled** — no amenities field |
| Rules & defaults | Policies | `policy.tenant_rules` (check-in, notice, refund) |
| | Tenant defaults | deposit months · agreement months (already shipped) |

### Finance screen — "How money moves through your business"

| Section | Row | Source |
|---|---|---|
| Money in | Rent rules | `policy.billing` generation day · due day · grace days |
| | Security deposit | deposit months, refundable at move-out |
| | Advance payments | **disabled** — no policy field |
| Penalties | Late fees | real ₹/day + grace (already shipped) |
| Getting paid | Payment methods | **disabled** — config model does not exist |
| | Payment gateway | kept enabled, linking to the existing informational page, with a truthful sub-line instead of the mockup's "Not connected"; **not counted as configured** |
| Compliance & receipts | Receipts | numbering series + auto-email flag |
| | GST | `hostels.gst_number` |

### Change log — makes Recent Changes and "· 2d ago" real

- **Write:** `configChangeLog.record()` wrapping `ActivityService.log()` — `action_type: "CONFIG_CHANGED"`, `entity_type: "hostel_policy" | "hostel_identity"`, `metadata: { module, field, label, from, to }`. Hooked into `PATCH /api/hostels/[id]/preferences` (one chokepoint covering every policy domain) and the hostel identity update.
- **Read:** `GET /api/owner/config-changes?limit=8`, owner-scoped, returning `{ id, label, module, at, actor: { name, is_you } }`.
- **Render:** coloured dot per module, label, then `Finance · Today, 9:24 AM · You`.
- Same data supplies each module card's relative timestamp. Until a change is logged, cards show the area count alone rather than a fabricated date.

### Pure logic (tested)

`apps/frontend` tests are node-environment with no jsdom, so logic lives in pure `.ts` with colocated tests and components stay thin renderers:

- `describeConfigChange(module, field, from, to)` → `"Late fee raised to ₹50 / day"` — TDD'd; the piece most likely to be got wrong and the only one with no I/O.
- `deriveConfigRows` / `countConfiguredAreas` — the counting rule, including the invariant that disabled rows never affect a count.
- Existing module-status and attention derivation moves out of `useConfigurationHub.ts` into pure functions so it becomes testable.

### Cleanup

Delete `src/platforms/owner/router/ConfigRoutes.tsx` and `src/app/layouts/ConfigShell.tsx`, and unregister from `AppRouter.tsx:4,18`. Those `/owner/config/*` routes currently resolve but are `RouteScaffold` placeholders unlinked from navigation. `OwnerRoutes.tsx:95` notes its auth-gate export is shared with `OnboardingRoute` — that export must survive.

## Out of scope

Automation, Agreements and Account module screens (slices 2–4). Team accounts and roles, 2FA and backup codes, clause library, dynamic variables, e-signature, SMS. Self-serve Razorpay onboarding — the only thing that would make "Payment gateway · Not connected" a real per-owner state. Advanced's backups / API / danger-zone rows: Advanced ships with import and export only.

## Known limitations

**Recent Changes starts empty.** Nothing has ever written a config-change event, so no backfill is possible; the timeline fills as changes are made. Module timestamps behave the same way.

Related vault pages: [[Features]], [[APIs]], [[Changelog]], [[Decisions]], [[Frontend]]
