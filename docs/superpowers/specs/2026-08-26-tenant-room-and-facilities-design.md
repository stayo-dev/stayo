# The tenant Room tab, and facilities that are actually true — Design

**Date:** 2026-08-26
**Status:** Proposed
**Surfaces:** tenant Room tab, owner marketing editor, owner room section, Discover listing
**Related:** [[Decisions]] ADR-040 (owners must not self-publish), ADR-084

## 1. What is there now, and how much of it is real

Measured against production, not read from the code:

| Section | Reality |
|---|---|
| Basic room card | **Real.** Room, sharing, floor, roommate count all come from the tenancy. |
| Living status | **0 rows** in `hostel_utility_status`, product-wide. No owner UI writes it — the only frontend references are tenant-side *readers*. Every "Normal" is a hardcoded default. |
| Roommates | **Real**, and the most useful thing on the page. |
| Room facilities | **Hardcoded literals.** "Hot water 6–10 AM · 6–10 PM", "Laundry · ground floor", "Drinking water RO purifier · corridor", "Housekeeping Daily" are written into the component. Only Wi-Fi reads data (`rooms.wifi_name`) — and **0 of 70 rooms** have it set, so every tenant sees "Ask the front desk". |
| Room services | **Real and used** — 9 rows in `tenant_service_requests`. |

Two bugs fall out of that table:

- **Living status has been lying since it shipped.** Not "hard for owners to maintain" — impossible: there is no screen on which to maintain it.
- **Every facility row renders the same Wi-Fi icon**, so Hot water and Laundry show a wifi glyph.

## 2. What the page becomes

Three sections. Nothing else.

1. **Your room** — unchanged.
2. **Roommates** — unchanged for occupied beds except the detail screen; **vacant beds become an invitation**.
3. **Facilities** — real, owner-authored, Wi-Fi among them.

**Living status is deleted**, along with its reads. `hostel_utility_status` and `/api/utility-status` are left in place but unreferenced — deleting a table is not this change's job, and an unused table costs nothing while a wrong screen costs trust.

**Room services' six-tile grid is deleted.** Reporting moves *into* the facility it is about (§5).

## 3. Facilities — one source, already gated

Owner-authored facility detail goes in the **existing marketing amenity**, extending `AmenitySchema`:

```ts
{
  label: string;          // "Hot water"            (exists)
  enabled: boolean;       //                        (exists)
  icon?: string | null;   //                        (exists)
  detail?: string | null; // "Attached bathroom"     NEW
  schedule?: string | null; // "6–10 AM · 6–10 PM"   NEW
}
```

`detail` and `schedule` are **free text**, matching `PlaceSchema.distance`'s existing reasoning ("owners measure in both"). A structured time range would demand a precision nobody keeps, and "6–10 AM & evenings" is a truer answer than a picker would allow.

Three consequences, all deliberate:

- **No migration.** `content` is `jsonb` on `hostel_marketing_revisions`.
- **The admin review gate applies for free.** Owner edits a draft, admin approves, it publishes. This is the answer to "facilities on Discover go through admin", and it keeps ADR-040 intact — an owner still cannot put text on a public listing unreviewed.
- **Tenant and Discover read the same approved revision**, so the two can never disagree.

**The tradeoff, stated plainly:** a tenant will not see changed hot-water timings until an admin approves the revision. That is slower than an operational field would be. It is accepted because two sources that can drift is a worse failure than a slow one, and because the owner is describing a standing arrangement, not today's weather.

## 4. Wi-Fi is not an amenity

Wi-Fi credentials get the opposite treatment, and the split is the point:

| | Facilities | Wi-Fi credentials |
|---|---|---|
| Scope | Per hostel | **Per room** (`rooms.wifi_name` / `wifi_password` — already exist) |
| Review | Admin-approved | **None** |
| Public | Yes, on Discover | **Never** |
| Visible to | Everyone | The room's tenants |

A Wi-Fi password behind an approval queue is absurd, and a Wi-Fi password on a public listing is worse. So the owner sets it in the **room section** of their dashboard — the editor that does not exist today, which is why all 70 rooms are blank — and the room's tenants see it immediately.

It renders inside the facilities list because that is where a tenant looks for it; it is simply sourced differently.

## 5. Reporting moves into the thing being reported

The six service tiles are replaced by a **Report a problem** action on each facility's detail screen — which the Wi-Fi screen already has.

Better than a generic tile for a reason beyond tidiness: the ticket arrives **already categorised**. "Hot water" reported from the Hot water screen needs no triage. Complaints stays as one row for everything that is not a facility.

**Scope, per instruction: build the UI only.** Owner-side handling of these reports is deliberately out of scope. The tenant-side submit should reuse the existing `tenant_service_requests` endpoint rather than inventing a second path — nine real tickets already flow through it.

## 6. Vacant beds become invitations

Today a vacant bed opens a dead-end screen: *"This bed is currently vacant. A new tenant may be allocated soon."* Nothing to do, nothing gained.

It becomes **"Invite a friend to this room"**, sharing the hostel link through the **existing share sheet** (`ShareSheet.tsx`, shipped 2026-08-26) so there is one share implementation and one link format (`/h/<slug>`, ADR-084).

Occupied beds show **name and phone only** — enough to knock on a door or call, and nothing a roommate would resent being handed out.

## 7. What each surface has to change

| Surface | Change |
|---|---|
| `TenantRoomPage.tsx` | Delete Living status and Room services. Facilities read the approved revision + room Wi-Fi. Per-facility icons. |
| Vacant-bed overlay | Replace with the invite screen. |
| Owner marketing editor | `detail` + `schedule` inputs per amenity. |
| Owner room section | **New**: Wi-Fi SSID/password editor. |
| `marketing-content.ts` | Extend `AmenitySchema`. |
| `listing-projection.ts` | Pass `detail`/`schedule` through to Discover. |
| Discover `ListingPage` | Render detail/schedule under each amenity. |

## 8. Testing

`apps/frontend` is node-only, so logic goes in pure `.ts` with colocated `.test.ts` and components stay renderers.

- Facility projection: an amenity with no `detail`/`schedule` renders as it does today; a disabled one never reaches either surface.
- Wi-Fi: absent credentials fall back without implying the network is down.
- The tenant page and the listing derive from **one** projection — pinned, so they cannot drift.
- `AmenitySchema`: `detail`/`schedule` optional, length-capped, and absent by default so existing revisions parse unchanged.

## 9. Moving out — the backend is already there

Almost none of this is new work, which is the main finding:

| Piece | State |
|---|---|
| `POST /api/move-out/requests` | **Exists, and already accepts a TENANT session** — it sets `initiatedByRole = "TENANT"` itself. |
| Owner pipeline (vacate → inspect → settle) | **Exists**, with 1 real request through it. |
| Notice-period handling | Exists (`move-out-service`), though `notice_period_days` is NULL on every live template, so nothing is currently recorded as a violation — see ADR-112. |
| Tenant UI to raise one | **Missing entirely.** |

So this is a UI change against a working endpoint, not a feature build.

**Two entry points, one implementation.** A tenant thinks about leaving either while looking at their room or while looking at their record, so the action appears in both — as the *same* component, so the two can never ask different questions or send different payloads.

**Placement is deliberately quiet.** Moving out is consequential and irreversible-ish: it starts a settlement, frees the bed, and notifies the owner. It sits at the **foot** of the Room tab in muted styling, not as a button competing with Facilities. The confirmation states what actually follows — the planned exit date, that the owner is notified, and that settlement follows — rather than a generic "Are you sure?".

## 10. The profile's accommodation summary

Also largely built, and the gap is narrower than it looks:

| Piece | State |
|---|---|
| `residencyHistoryService.getOwnHistory()` | **Exists** — returns `stays[]` with `is_current`, `duration_months`, plus `total_stays` and `total_months`. |
| `/profile/history` page | **Exists.** |
| `useResidencyHistory()` on the profile hub | **Already called.** |
| "Your details (this stay)" | **Exists**, tenancy-scoped. |
| A summary of the stay they are *in* | **Missing** — the hub links to history but never says where they live now. |

**Add a current-stay card** to the profile hub, above "Your record": hostel, room, since when, months so far. Every value comes from the existing `is_current` stay — no new service, no new query.

**And fix a small lie while there.** The hub renders `${history.total_stays} past stays`, and `total_stays` counts only stays where `is_current` is false. Someone in their first hostel therefore reads **"0 past stays"** on the profile of a person who is, right now, living somewhere. The line needs to account for the current stay rather than report a person as having stayed nowhere.

The move-out action appears on this card too — the same component as §9.

## 11. Explicitly out of scope

- Owner-side handling of facility reports (§5).
- Deleting `hostel_utility_status` or `/api/utility-status`.
- Structured time ranges instead of free text (§3).
- Any change to how amenities are reviewed or published.
- Any change to the move-out **pipeline** — this adds entry points to an endpoint that already works (§9).
- Setting `notice_period_days`, which stays NULL and therefore keeps recording no notice violations (ADR-112).
