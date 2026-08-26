# Owner Tenant Profile — wiring, redesign, and de-duplication

**Date:** 2026-08-26
**Surface:** `/owner/tenants/:tenantId` — [`apps/frontend/src/features/owner-tenants/pages/TenantDetailPage.tsx`](../../../apps/frontend/src/features/owner-tenants/pages/TenantDetailPage.tsx)
**Status:** Design approved, spec pending review

---

## 1. Problem

The owner-side tenant profile looks finished and is not. Several of its
sections are visual re-implementations of components that exist, work, and are
wired to real endpoints — with the handlers dropped on the floor. An owner can
see a Communication Center they cannot tap, a Private Notes box that discards
what they type, an "Add Charge" button that does nothing, and a "Change room"
button that leads to a form asking them to type a room's UUID.

The root cause is structural, not incidental.

### 1.1 Two tenant-profile trees, and the working one is dead

| Tree | Routed? | State |
|---|---|---|
| `features/owner-tenants/pages/TenantDetailPage.tsx` (524 lines) | **Yes** — `/owner/tenants/:tenantId` | Stayo-styled. Several sections are static markup. |
| `features/tenants/components/profile/TenantProfilePage.tsx` (~700 lines) + `TenantProfileDrawer.tsx` | **No — zero importers** | Pre-Stayo visually, but holds the *wired* `CommunicationCenter`, `TransferRoomSheet`, `PendingBanner`, `ComplaintsSection`, `PrivateNotes`. |

Work landed in the dead tree; the live page copied the *appearance* of that
work. Every bug below is a symptom of that split.

### 1.2 Confirmed defects

Numbered for traceability into the task list in §5.

**D1 — Communication Center is decorative.**
`CommRowActions()` at [`TenantDetailPage.tsx:509-519`](../../../apps/frontend/src/features/owner-tenants/pages/TenantDetailPage.tsx#L509) renders four `<span>` elements. Not buttons, no
`onClick`, no `aria-label`. The wired equivalent —
`features/tenants/components/profile/CommunicationCenter.tsx`, with
call / WhatsApp / copy / history — renders nowhere. The third icon (`FileText`)
maps to no action in either version. The History icon has no data source.
Emergency contact is never rendered despite `phone_3` and
`profile.emergency_contact` being present on the response.

**D2 — Private Notes discards input.**
`useTenantNotes` is fully wired to `GET/POST/DELETE /api/tenants/:id/notes`
and is called only by `InvitedTenantProfileView`. On the live page the `+`
button has no `onClick` and *"No private notes yet."* is a hardcoded string.

**D3 — "+ Add Charge" is a no-op.** No `onClick`. `CreateObligationModal` is
wired but reachable only via Actions → Create Charge.

**D4 — Room change is impossible from the UI.**
The Stay tab's "Change room" calls `setActionsOpen(true)`; the Actions sheet has
no room row. The only other path is Actions → Request Change → Transfer Room,
where the room field is `{ key: 'room_id', label: 'Room', type: 'text' }`
([`ChangeRequestDrawer.tsx:99-101`](../../../apps/frontend/src/features/change-management/components/ChangeRequestDrawer.tsx#L99)) — a free-text box for a UUID — submitted via
`tenantService.update()`, which routes to the change-management facade. `room_id`
is not a `tenant_profile` field, so the diff engine drops it. The change silently
does nothing.

Three working backends exist and none are reachable:
`POST /api/allocations/shift` (transactional, owner-scoped, via
`roomAllocationService.shiftRoom`), `POST /api/tenants/transfer` (cross-hostel),
and `TransferRoomSheet` (wired, working, raw `<select>`, dead).

**D5 — Request Change computes diffs against blanks.**
The page passes `tenantData = { name, phone_1, monthly_rent, security_deposit }`.
The drawer asks for email, guardian name/phone, college, agreement dates, and
maintenance charge. All of those render `Current: —`, so the "before" side of
every diff is empty and the summary misleads.

**D6 — Two live writers for `monthly_rent`, with opposite rules.**
- `POST /api/tenants/:id/change-rent` — identity-confirmed (password re-entry),
  reprices unpaid obligations at/after the effective month via
  `applyRentChangeInTx`. Documented in [[Business-Rules]] §"Rent changes are
  immediate and owner-only — no tenant approval" as a **deliberate, scoped
  exception**.
- `PATCH /api/tenants/:id` with `monthly_rent` — policy engine classifies it
  Category C / L3, **requires tenant approval**, and does **not** reprice
  obligations.

The drawer's "Amend Agreement" uses the second. This contradicts the documented
rule and skips obligation repricing.

**D7 — Profile photo never displayed.** `photo_url` is returned by
`getOwnerTenantOverview` (top level *and* nested under `tenant`), and
`POST /api/tenants/:id/photo` exists. `useTenantDetail` never maps it; the
header renders initials only.

**D8 — Agreement preview missing.** `current_agreement` — with `pdf_url`,
`status`, start/end dates, `contract_rent`, `contract_security_deposit` — is on
the overview response and never read. `GET /api/tenants/:id/documents` already
synthesises a virtual `RENTAL_AGREEMENT` document with a working download URL.
The header shows a bare "Pending" / "Active Contract" with nothing to open.

**D9 — Document View/Download is unauthenticated.**
`DocumentReviewCard` uses `window.open(doc.downloadUrl)` and
`<a href={downloadUrl} download>`. Both are bare cross-origin GETs carrying no
`Authorization` header. `middleware.ts:190-194` accepts a header token, then the
`hms_session` cookie, then a query token (SSE only). `hms_session` is written
only at `/api/auth/login` (and signup/activate) and is **never refreshed** —
Supabase refreshes into localStorage, not that cookie. So the links work for
roughly one access-token lifetime after login and 401 afterwards; under
Safari/ITP cross-site cookie blocking, never. Separately, `<a download>` is
ignored by browsers for cross-origin URLs — it navigates instead of downloading.

> **Verification required before the fix lands.** The mechanism is traced from
> source but has not been reproduced against a running instance. Task T9a
> reproduces it first.

**D10 — Tenant document-share requests have no owner UI at all.**
`GET /api/owner/document-shares` and `PATCH /api/owner/document-shares/:shareId/verdict`
(the identity-vault system, ADR-110/111/112) have **zero frontend callers** —
verified by grep across `apps/frontend/src`. A tenant sharing a vault document
with the hostel creates a review request no owner can see or act on.

Note this is a *second, parallel* document system alongside
`identification_documents`. Both are live. §3.4 defines how the profile presents
them without inventing a merge.

**D11 — Document conversation is read-only.** `parseRejectionThread` already
parses the owner↔tenant thread from `rejection_reason`, and
`POST /api/tenants/:id/documents/:docId/message` + `tenantService.postDocumentMessage`
exist. `DocumentReviewCard` renders only the latest owner rejection line. The
tenant's reply is fetched and thrown away.

**D12 — `useTenantDetail` discards most of the payload.**
Fetched and unused: `email`, `overdue_amount`, `current_payable_amount`,
`advance_balance` (future rent credit), `recent_payments`,
`compliance.rules_accepted` / `rules_accepted_at` / `rules_snapshot`,
`profile.phone_verified`, college/course/year/branch, gender, DOB, permanent and
temporary address, `move_out_requests`.

Concrete bug: `overdueMonths: Number(o.overdue_amount ?? 0) > 0 ? 1 : 0`, then
rendered as `{tenant.overdueMonths} days` under the label OVERDUE. The number is
neither months nor days — it is a boolean wearing a unit.

**D13 — Charges tab silently truncates.** `/api/tenants/:id/full` caps
`rent_obligations` at 5 server-side. The UI prints "Showing the last N charges"
without saying more exist, and never links to `/financial-timeline` or
`/financial-ledger`, both of which are live.

**D14 — Risk & Compliance is a dead end.** Score, grade, trend, and
`insights[0]` are rendered with no way to see what drives them and no link to
the payment behind an insight.

**D15 — No per-tenant service requests.** The owner sees complaints and service
requests only hostel-wide at `/owner/more/service-requests`. There is no way to
ask "what has *this* tenant raised?" from their profile. `ComplaintsSection`
exists in the dead tree.

---

## 2. Goals and non-goals

### Goals
1. No control on this page is inert. Every button either performs a real
   backend action or is not rendered.
2. Room change costs two taps.
3. The owner can see the tenant's photo, their agreement, their documents, and
   any review request the tenant has raised — all previewable in-app.
4. Owner cannot edit a tenant's personal information.
5. One tenant-profile tree, not two.
6. Every surface is Stayo-styled and consistent with the rest of the owner app.

### Non-goals
- Tenant-side changes. The tenant portal is untouched by this work.
- Cross-hostel transfer (`/api/tenants/transfer`). Different concern.
- Redesigning `QuickCollectModal`, `MoveOutSheet`, or `ChangeRentModal` —
  already Stayo-styled and correctly wired.
- Backfilling the `docs/` narrative layer beyond what the documentation rule
  requires.

---

## 3. Design

### 3.1 Structure — decompose, harvest, delete

`TenantDetailPage` becomes a composition root. Sections move to
`features/owner-tenants/profile/`:

```
features/owner-tenants/profile/
  ProfileHeader.tsx          avatar, name, status, hostel/agreement strip
  CommunicationCard.tsx      tenant / guardian / emergency contact rows
  PrivateNotesCard.tsx       notes list + composer
  RiskCard.tsx               score, trend, insights
  MoneyStrip.tsx             outstanding / overdue / deposit / future credit
  tabs/ChargesTab.tsx
  tabs/ActivityTab.tsx
  tabs/DocumentsTab.tsx
  tabs/StayTab.tsx
  contactChannels.ts         pure — what actions a contact row offers
  overdueDisplay.ts          pure — days-overdue + label from the money fields
  roomOptions.ts             pure — which rooms a tenant can be moved into
  documentGroups.ts          pure — groups identification docs and vault shares
```

Per `apps/frontend`'s node-only vitest setup (`src/**/*.test.ts`, no jsdom,
no component rendering), the three `.ts` modules carry the decision logic and
are unit-tested directly. Components stay thin renderers over already-tested
state — no `.test.tsx`.

Harvest from the dead tree, then delete `features/tenants/components/profile/TenantProfilePage.tsx`
and `TenantProfileDrawer.tsx`. Components in `features/tenants` that survive
because other live surfaces import them (`CreateObligationModal`,
`TransferRoomSheet`'s allocation logic) stay where they are.

**Deletion guard:** before removing any file, grep for importers. Delete only
files with zero live importers.

### 3.2 Communication Center (D1)

Each contact row is a real card with four real controls:

| Control | Action |
|---|---|
| Call | `actions.callTenant(phone)` — `tel:` on mobile, copy + toast on desktop |
| WhatsApp | `actions.whatsAppTenant(phone)` — `wa.me` deep link |
| Copy | `actions.copyPhone(phone)` |
| History | expands the reminder/contact log for that number |

Rows rendered: **Tenant**, **Guardian** (when `guardian_phone`), **Emergency
contact** (when `phone_3` or `profile.emergency_contact` differs from the
guardian's number). The `FileText` icon is removed — it mapped to nothing.

History is sourced from `recent_activity` entries of `type: "reminder"`
(backed by `reminder_logs`, already on the response). `contactChannels.ts`
owns the rule for which controls a row offers given the data it has — a row
with no phone number renders the card without call/WhatsApp/copy rather than
rendering dead buttons.

A phone with `profile.phone_verified === true` gets a small verified marker.

### 3.3 Room change in two taps (D4)

New `ChangeRoomSheet`, opened from **Stay tab → Change room** *and* a new
**Move Room** row in the Actions sheet.

```
┌─────────────────────────────────┐
│ Move Valurothu to…              │
│ Currently Room 202 · 4-bed      │
├─────────────────────────────────┤
│  Room 203    2 of 4 free  Fl. 2 │  ← tap 1
│  Room 105    1 of 3 free  Fl. 1 │
│  Room 301    3 of 4 free  Fl. 3 │
├─────────────────────────────────┤
│ Effective  Today       [change] │
│    [ Move to Room 203 ]         │  ← tap 2
└─────────────────────────────────┘
```

- Rooms from `roomService.getAll(hostelId)`, filtered to those with real
  vacancy and not `MAINTENANCE`/`BLOCKED` — reusing `TransferRoomSheet`'s
  existing filter, lifted into a tested pure function.
- Submits `POST /api/allocations/shift` with `{ tenant_id, new_room_id, shift_date }`.
- Effective date defaults to today and is collapsed behind "change".
- No reason field, no approval step, no confirmation dialog. This is the
  owner's own room inventory.
- Rent is **not** touched. If the target room's `base_rent` differs from the
  tenant's current rent, the success toast offers "Rent differs — review?"
  linking to `ChangeRentModal`. Informational, never automatic.
- Invalidates: tenant detail, `queryKeys.tenants.allocations`,
  `queryKeys.rooms.all` / `.list`, dashboard.

### 3.4 Documents (D8, D9, D10, D11)

The Documents tab presents **three groups**, in this order:

1. **Review requests** — vault shares from `GET /api/owner/document-shares?hostel_id=…&profile_id=…`
   with `status: PENDING`. Verdict via
   `PATCH /api/owner/document-shares/:shareId/verdict` (`VERIFIED` | `REJECTED`
   + reason). This group renders only when shares exist, so hostels not using
   the vault see no change.
2. **KYC documents** — `identification_documents`, the existing
   approve/reject/thread flow.
3. **Agreement** — from `current_agreement`, with status, period, contract rent
   and deposit, and Preview.

The two document systems are **presented side by side, never merged**. A share
verdict is scoped to the share (per-hostel); a KYC verdict is scoped to the
document. Merging them would silently cross that boundary.
`documentGroups.ts` owns the grouping and is unit-tested.

**Slice boundary.** Slice 1 ships groups 2 and 3 — the tab structure and
`documentGroups.ts` are built to accommodate group 1 from the start, but the
vault group itself, and the endpoints behind it, land in slice 2 (T13). Until
then `documentGroups.ts` is called with an empty share list, which is a tested
case, not a stub.

**Authenticated preview (D9).** New `useDocumentBlob(url)` hook: fetches
through the authenticated Axios client with `responseType: 'blob'`, produces an
object URL, revokes it on unmount. A Stayo-styled `DocumentPreviewSheet`
renders images inline and PDFs in an `<object>`/`<iframe>`, with page chrome
matching the rest of the owner app. Download becomes a blob-anchor click, which
works cross-origin. No backend change; correctness no longer depends on the
`hms_session` cookie's staleness.

**Conversation (D11).** `DocumentPreviewSheet` shows the full parsed thread and
a composer posting to `POST /api/tenants/:id/documents/:docId/message`. The
owner sees the tenant's replies instead of only their own last rejection line.

### 3.5 Agreement preview (D8)

The header's Agreement cell becomes tappable when `current_agreement` exists,
opening the same `DocumentPreviewSheet` against the virtual `RENTAL_AGREEMENT`
document. A summary card in the Stay tab shows status, period, contract rent,
contract deposit, and days to expiry. When no agreement exists it renders
"Not signed yet" and is not tappable.

### 3.6 Profile photo (D7)

`useTenantDetail` maps `photo_url`. `ProfileHeader` renders the photo, falling
back to the existing initials tile when absent or on image error. Tapping opens
it full-size. Owner-side upload is **not** added — the photo is the tenant's.

### 3.7 Request Change, reduced (D5, D6)

The intent picker is deleted. "Request Change" is replaced by a single
**Amend Agreement** row in the Actions sheet, opening one form.

Removed:
- **Change Personal Information** — owners do not edit a tenant's identity.
  Removed from the UI entirely. The backend policy (Category B / L2) is left
  alone; this is a UI decision, not a permission change.
- **Transfer Room** — replaced by §3.3.
- **Correct Financial Data** — deposit is an agreement term and moves into
  Amend Agreement; maintenance charge moves there too.
- **Monthly Rent** — `ChangeRentModal` (`POST …/change-rent`) is the **single
  writer for rent**, per the documented exception in [[Business-Rules]]. Amend
  Agreement links to it rather than duplicating the field.

Amend Agreement covers: `agreement_duration_months`, `agreement_start_date`,
`security_deposit`, `maintenance_charge`, `maintenance_type`. These are
Category C / L3 — the facade already classifies and routes them, so the
frontend does not decide policy. It submits, then reports the *actual* result:
"Applied" (correction window) or "Sent to tenant for approval".

The form is seeded from the **full** overview response, not the four-field
subset — fixing D5 at its source.

**Pending state becomes visible.** `PendingBanner` + `ChangeTimeline` +
`useTenantChangeRequests` (all built, all currently dead) are wired onto the
profile so a pending amendment is visible with its diff and timeline, and
cancellable via `POST /api/change-requests/:id/cancel`.

### 3.8 Data the owner should have (D12, D13, D14)

`useTenantDetail` maps the rest of the payload. New surfaces:

- **Money strip** gains **Future credit** from `advance_balance`, and
  `overdueDisplay.ts` replaces the boolean-as-days bug with real days overdue
  derived from the oldest unpaid obligation's due date, plus an honest label.
- **Identity card** in the Stay tab: email, phone-verified state, profile type,
  college/course/year (or office/role), gender, DOB, addresses.
- **Compliance** gains rules-accepted state, version, and accepted-on date.
- **Charges tab** states the 5-row cap plainly and links to the full financial
  timeline.
- **Risk card** shows all `insights` and `suggestions`, not `[0]`.
- **Move-out banner** when a `move_out_requests` row is open.

---

## 4. Error handling and testing

**Errors.** Every mutation reports through `stayoToast` with the server's
message where present. Room shift surfaces `roomAllocationService`'s real
failures (room full, tenant not active) rather than a generic "Transfer
failed". Document preview distinguishes 401/403 (session) from 404 (missing
file) from 502 (upstream fetch failed) — D9 was invisible precisely because a
blank tab looks like nothing happened. Amend Agreement surfaces
`CONCURRENCY_ERROR` from the facade's optimistic-version check as "This tenant
changed while you were editing — reopen and try again."

**Tests.** Node-environment vitest, `src/**/*.test.ts`:
- `contactChannels.test.ts` — which controls a row offers; emergency contact
  deduplicated against guardian; missing-phone case.
- `overdueDisplay.test.ts` — days overdue and label across paid / partial /
  overdue / future-credit states; the D12 regression is a named case.
- `roomOptions.test.ts` — vacancy filter, exclusion of current room,
  `MAINTENANCE`/`BLOCKED` exclusion.
- `documentGroups.test.ts` — three-group split, empty groups omitted, vault and
  KYC never merged.

Backend `npm run check:invariants` after any change touching hostel scoping
(the document-shares call passes `hostel_id` explicitly and must never fall back
to "first hostel").

---

## 5. Task list

### Slice 1 — make it real

| # | Task | Fixes |
|---|---|---|
| T1 | Decompose `TenantDetailPage` into `profile/` sections; grep-verified deletion of `TenantProfilePage` + `TenantProfileDrawer` | §3.1 |
| T2 | `CommunicationCard` with real call / WhatsApp / copy / history + emergency contact; `contactChannels.ts` + tests | D1 |
| T3 | `PrivateNotesCard` on `useTenantNotes` — list, add, delete, empty state | D2 |
| T4 | Wire "+ Add Charge" to `CreateObligationModal` | D3 |
| T5 | `ChangeRoomSheet` (2 taps) on `POST /api/allocations/shift`; wire Stay tab + new Actions row; `roomOptions.ts` + tests | D4 |
| T6 | Map `photo_url`; photo in `ProfileHeader` with initials fallback | D7 |
| T7 | Map the full overview payload; `overdueDisplay.ts` + tests; future-credit tile; identity + compliance cards; move-out banner | D12, D14 |
| T8 | Charges tab: state the cap, link to financial timeline | D13 |
| T9a | **Reproduce D9** against a running instance; record the actual failure | D9 |
| T9b | `useDocumentBlob` + Stayo `DocumentPreviewSheet`; authenticated view and download | D9 |
| T10 | Agreement preview from header + agreement summary card in Stay tab | D8 |
| T11 | Reduce Request Change → Amend Agreement; remove personal-info, room, and rent fields; seed from full payload; link rent to `ChangeRentModal` | D5, D6 |
| T12 | Wire `PendingBanner` + `ChangeTimeline` + cancel onto the profile | D5 |

### Slice 2 — new surfaces

| # | Task | Fixes |
|---|---|---|
| T13 | Vault review-requests group: `GET /api/owner/document-shares`, verdict `PATCH`, Stayo cards; `documentGroups.ts` + tests | D10 |
| T14 | Document conversation: full thread + composer on `POST …/documents/:docId/message` | D11 |
| T15 | Per-tenant service requests / complaints section | D15 |
| T16 | Risk card detail: all insights and suggestions, links to the driving payments | D14 |

### Documentation (same change, per CLAUDE.md)

| # | Task |
|---|---|
| T17 | [[Features]] + [[Changelog]] — the rebuilt profile |
| T18 | [[Bugs]] — D1, D2, D4, D9, D12 (each revealed a real design gap) |
| T19 | [[Decisions]] — ADR: owner cannot edit tenant personal information; ADR: `change-rent` is the single rent writer and `monthly_rent` is not offered through the facade path in owner UI |
| T20 | [[Frontend]] — the `owner-tenants/profile/` structure and the removal of the dead `features/tenants` profile tree |

---

## 6. Open questions

- **D9 severity.** Traced from source, not reproduced. T9a settles it. If the
  cookie turns out to be refreshed by a path not found in this pass, T9b is
  still worth doing for the in-app preview UX, but drops from bug to
  enhancement.
- **Vault adoption.** Whether any production hostel currently has
  `identity_document_shares` rows is unknown. T13 is correct either way — the
  group renders only when shares exist — but it determines whether T13 is
  urgent or preparatory.
- **Emergency contact source of truth.** `phone_3` and
  `profile.emergency_contact` both exist and may disagree. `contactChannels.ts`
  will prefer `phone_3` and fall back, but which is canonical is
  **Unknown / needs clarification** — worth resolving with the team rather than
  cementing the guess.
