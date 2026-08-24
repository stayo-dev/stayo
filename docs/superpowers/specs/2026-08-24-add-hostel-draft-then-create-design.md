# Add Hostel: draft locally, validate at every stage, create once — Design

**Date:** 2026-08-24
**Status:** Proposed
**Scope:** The Add Hostel builder (`apps/frontend/src/features/owner-hostel-builder`) and the
endpoint that will replace its three write calls. The Rooms tab's own editing (Add Floor / Add
Room / room edit) is untouched — see §9.
**Related:** [[Decisions]] ADR-066, ADR-097, ADR-108, ADR-109

## 1. What happens today, and why it is wrong

The builder writes as it walks. Naming the hostel creates the `hostels` row; setting the floor
count creates every `floors` row; leaving a floor writes that floor's `rooms`. Three endpoints,
called at three different moments, before the owner has said they want any of it.

The consequence is the one reported: **an owner who opens Add Hostel to look around leaves a real
hostel behind.** Type a name, press continue, close the tab — that hostel is in the account, on the
dashboard, in the portfolio aggregate, and counted by the lead funnel. There is no "cancel". The
only exit is the archive flow ([[Decisions]] ADR-099), which is a deliberate, confirmed action
about a property that exists — not an undo for something that should never have existed.

Every junk hostel in the account today was created this way.

## 2. What the incremental model was buying

This was a deliberate choice, not an accident. `useHostelBuilder.ts:31` states it:

> Writes are incremental by design: the `hostels` row exists from the moment it is named, floors
> are created when their count is set, and each floor's rooms are saved on leaving that floor. So
> "finish later" needs no local draft — the partly-built hostel is already the owner's, resuming is
> a read, and progress is derived from which floors have rooms rather than from a stored step
> counter that could disagree with the data.

Three things, and each needs an answer before the model can be inverted:

| Bought by incremental writes | Replaced by |
|---|---|
| "Finish later" needs no local draft | A schema-versioned localStorage draft (§4) |
| Resuming is a read | Resuming is a draft parse (§4) |
| Progress derived from data, not a step counter | Progress derived from the draft's own floors — still derived, never a stored step number |

The third point is the one worth preserving carefully. The original objection to a stored step
counter was that it can disagree with reality. A draft has the same hazard, and the answer is the
same: derive progress from the draft's floors and rooms, never store "which step am I on" as an
independent fact that can drift.

## 3. The organising principle: defer the write, not the feedback

The obvious failure mode of "collect everything, then submit" is that **errors move from early to
late**. Today a duplicate hostel name fails at the naming step, immediately. A naive single-create
would fail after four floors of rooms had been entered — the worst possible moment to be told.

So this design deliberately separates two things that are usually conflated:

- **Validation happens at every stage**, exactly as it does now, and gets *stronger* — holding the
  whole building in hand makes checks possible that no single write could ever perform.
- **The write happens once**, at the end, after confirmation.

The confirm step re-validates everything as defence in depth, but it should almost never be where
the owner first learns about a problem. If it is, that is a bug in the per-stage validation, not an
accepted cost.

### What each stage validates

**Name stage.** Non-empty, ≤ 120 chars (already enforced). **New: name availability**, checked on
leaving the step via a read-only lookup that creates nothing. Today this arrives as a `409
ALREADY_EXISTS` from the create; it becomes a field error where the field is.

**Floors stage.** Count within 1–12 (already enforced). Floor names non-empty after trim (falls back
to `defaultFloorName`), and **no two floors sharing a name** — not currently checked anywhere, and
"First floor" twice in one building is a data problem the owner should hear about while they are
looking at the list.

**Rooms stage, per floor.** `floorBlocker` already covers: at least one room, every room numbered,
no duplicate number *within the floor*, every room has a sharing size. Unchanged.

**Rooms stage, across floors.** **New, and only possible because of this change.** Duplicate room
numbers *between* floors. The per-floor save could never check this — it only ever saw one floor,
and the server caught it as a `CONFLICT` on whichever floor happened to be saved second. With the
whole building in hand, the strip can mark the offending floor the moment the collision appears.

**Confirm stage.** Everything above, re-run over the assembled payload. Cheap, pure, and the last
line of defence.

## 4. The draft

`hostelDraft.ts`, modelled directly on `onboardingDraft.ts` — same key convention, same schema
version discipline, same reasoning about where it lives.

```
stayo.hostelBuilder.draft
{ version, name, city, numbering, floorNames, floors, activeIndex, savedAt }
```

Schema-versioned: a draft written by an older build is **discarded, not migrated**. Half-parsing an
unknown shape into a building is worse than starting over.

localStorage rather than a server draft, for the reason `onboardingDraft.ts` already gives: it
covers the loss that actually happens — reload, tab close, browser restart on the same device.
Switching device mid-build loses it, an accepted limitation rather than an oversight. A server-side
draft would also reintroduce, in weaker form, the thing this change exists to remove: a row on the
server before the owner has committed.

**Type change:** `DraftFloor.id` is currently a server `floors.id`, assigned at creation. In a draft
there are no server ids, so it becomes a locally-generated key and only becomes meaningful after
the create. Every consumer that treats it as a server id must be checked.

## 5. The create

**`POST /api/owner/hostels/build`** — the whole building, one `prisma.$transaction`.

```
{ name, city?,
  floors: [{ name, rooms: [{ room_no, capacity, base_rent? }] }],
  identity_token? }
```

The numbering scheme is **not** in the payload. It is client-side state that decides what
`room_no` each room gets; by the time the payload is assembled every number is already resolved,
and `hostels` has no column to store the scheme in. Sending it would imply a persistence that does
not exist.

This is a new payload over a proven transaction, not new machinery.
`hostel-provisioning-service.ts:126` already creates hostel → floors → rooms inside one `tx` and
fires `markHostelCreated`. It was deprecated by [[Decisions]] ADR-066 for its *payload* — a uniform
`rooms_per_floor × beds_per_room × one rent` grid that cannot express a floor mixing sharing sizes
— **not** for its atomicity, which is exactly what is wanted here.

**Validation is a pure planner**, `buildHostelPlan.ts`, in the same shape as `planFloorRoomSave`
([[Decisions]] ADR-097): it takes the payload and returns either the writes or a refusal naming the
floor and the reason. This repo has no provisioned test database, so rules that live only inside a
transaction cannot be tested at all; the planner is where the rules live and the service only
executes it.

**Both funnel hooks fire here**, once: `markHostelCreated` and `markLiveForOwner`. Under a single
create both facts — a hostel exists, and it has rooms — become true at the same instant.

`markLiveForOwner` is **added** here, not moved. It currently fires from `POST /api/floors/:id/rooms`,
which is also the Rooms tab's path: an owner adding the first rooms to a legacy half-built hostel
must still reach LIVE. Removing it there to "move" it here would silently strip the funnel
transition from every hostel not built through this flow. It is idempotent by nature (it advances a
lead that is already past that stage to nothing), so firing from both paths is safe.

**The step-up password moves here.** Rule unchanged from [[Decisions]] ADR-066: required only when
the owner already has an ACTIVE/INACTIVE hostel. Today it interrupts at the *naming* step, because
that is when the row was created; it now appears at the confirm, which is where the owner is
actually committing. One prompt, at the moment it means something.

## 6. Preview and confirm

The existing Review stage becomes the preview and gains the create.

Shown: hostel name, city, each floor with its room count and bed total, the sharing mix, and the
rent range. **Nothing derived that is not real** — in particular no projected revenue, which the
current Review already refuses to show, for the reason recorded in `hostelBuilder.ts`: `base_rent`
is an invite default, tenants routinely differ from it, and no bed is let yet.

The primary button becomes **Create hostel**. On success: clear the draft, invalidate the portfolio
queries, navigate to the new hostel. On failure: stay, show the reason, keep the draft. The draft is
cleared **only** after a confirmed success — a failed create that also lost the building would be
the worst outcome this design can produce.

## 7. What is deleted, and what survives repurposed

**Deleted:** the `createHostel`, `createFloors` and `saveFloor` mutations from the builder; the
`/owner/hostels/:hostelId/build` resume route.

**Changed:** `floorChipState` collapses from three states to two — "saved" has no meaning before
anything exists, so a chip is either "has rooms" or "empty".

**Survives, repurposed:** `sweepBlocker` (ADR-108). It was built last change to validate every floor
before the sweep wrote any of them; validate-all-before-writing-any is precisely what the confirm
step needs. It moves from "before the sweep" to "before the create" and keeps its tests.

The sweep itself goes. With no per-floor writes there is nothing to sweep, and `advance()` becomes
pure navigation.

## 8. Existing half-built hostels

The account already contains hostels created by the old model with no rooms. Home surfaces them as
"continue building" and links to `/owner/hostels/:hostelId/build`.

The builder becomes **draft-only, one job**. Home's continue-building link points at the hostel's
**Rooms tab**, which already has working Add Floor and Add Room and is where such a hostel is
edited anyway. The alternative — a builder with two write models, every step knowing which it is in
— buys nothing and costs a permanent fork in the most complex flow in the owner app.

## 9. Out of scope

- **The Rooms tab's own editing.** `saveRoomsForFloor` and its idempotency (ADR-097) stay exactly as
  they are; that path serves editing a hostel that exists, which is a different job from building
  one that does not.
- **Migrating existing half-built hostels.** They remain, editable through the Rooms tab, and
  deletable through ADR-100's permanent delete once empty.
- **Server-side drafts.** Rejected in §4; revisit only if device-switching mid-build turns out to
  matter.

## 10. Testing

Pure modules, both sides, no DOM and no database:

- `hostelDraft.ts` — round-trip, version mismatch discards, malformed JSON does not throw, a draft
  missing fields does not produce a half-built building.
- `buildHostelPlan.ts` — every refusal in §3, including the cross-floor duplicate that was
  previously uncheckable; and that a refusal returns **no writes at all**.
- `floorStrip.ts` — updated for two chip states; `sweepBlocker`'s existing tests carry over.

Not covered by tests, and stated rather than implied: the transaction itself. As with every other
write in this repo, it can only be exercised against a real database.

## 11. Clearing a draft that is not going to be finished

A draft that outlives the owner's intent is its own kind of junk: they abandon a build, return a
month later, and are dropped back into a half-built hostel they have forgotten.

**Decided: prompt on resume.** Opening Add Hostel with a draft present asks whether to continue
that build or start fresh, showing what the draft holds ("Sunrise Residency · 2 floors, 7 rooms ·
saved 3 weeks ago"). The alternatives were an age-out on parse and a discard button; the prompt is
the only one of the three that cannot silently destroy work the owner still wanted, and it is the
only one that makes an old draft visible rather than surprising. "Start fresh" discards the draft
after a confirmation, since that *is* destructive.
