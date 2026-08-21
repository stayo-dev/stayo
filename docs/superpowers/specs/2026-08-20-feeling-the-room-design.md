# Making a room *felt*, not stated — 360° views and spatial understanding

**Date:** 2026-08-20
**Status:** proposal, not built
**Related:** [[Features]], [[Database]], `listing-media-roadmap` memory

## The observation this starts from

People choosing a hostel do not only ask "is it nice and what do I get". They
ask **how big is it** and **where do my things go** — and a listing that says
"120 sq ft" answers neither, because almost nobody can convert that number into
a feeling. The ask is to make someone *feel* the space before they visit.

Two separate problems live inside that, and they need different tools:

1. **What the room looks like from inside it** → a 360° capture is the right
   instrument.
2. **How much room there actually is, and where possessions go** → 360° does
   *not* solve this. A panorama flattens distance; you cannot judge from one
   whether a suitcase fits under the bed. This half needs structured facts and
   drawing, not more photography.

## The blocker, stated first

**Stayo collects none of the data any of this needs.** `rooms` carries
`capacity`, `base_rent`, `floor`, `room_no` — no dimensions, no storage, no
window count. `rooms.photos` exists and is empty for every hostel. So the
first phase of this work is not a viewer; it is asking owners four or five
questions and reviewing the answers like any other listing content.

Anything built before that would be decoration over missing facts, which is
the failure mode `trust_sections` already demonstrates on this codebase —
hardcoded reassurance ("Owner-managed records", "Contact the hostel for
current curfew timing") rendered identically for every hostel.

## Phase 1 — the facts, and honest arithmetic (no new technology)

Add to each room, owner-entered and admin-reviewed:

| Field | Why this one |
|---|---|
| `length_ft` × `width_ft` | Two numbers an owner can measure with a tape. Not "area" — a 6×20 room and a 11×11 room are the same area and completely different to live in. |
| `cupboard_per_bed` | The single most-asked storage question in shared rooms. |
| `under_bed_storage` | "Fits one large suitcase" / "fits a cabin bag" / "none". |
| `study_desk` | Per bed, shared, or none. |
| `windows` | A count. Two windows and none is the difference between a room and a cell. |
| `ceiling_fan` / `ac` | Already partly in amenities; per room it means something different. |

Then compute and show, deriving rather than asking:

- **Floor area per bed** — `(length × width) / capacity`. This is the number
  that actually differs between hostels and the one nobody publishes. A 140
  sq ft 4-sharing room is 35 sq ft a person; the same room as a 6-sharing is
  23. Same photo, very different life.
- **A one-line comparison anchor**, generated from the dimensions, never from
  a lookup table of adjectives: "11 × 13 ft — about the size of a small
  bedroom" is honest; "spacious" is not.
- **Storage as counted objects**: "1 lockable cupboard per person · one large
  suitcase under each bed · shared study table". Countable nouns, not
  adjectives.

This alone answers most of the question, costs one form and one migration, and
is comparable **across** hostels — which is what makes a marketplace useful.

## Phase 2 — a drawn plan, to scale

From the same numbers, generate a top-down SVG: the room outline to scale,
with beds, cupboards, desk, door and windows placed by a simple layout rule
(beds along the long walls, door on the short one unless the owner says
otherwise). Beside it, a familiar object drawn at the same scale — a 24-inch
suitcase, a study chair — so the scale is legible without reading a number.

This is where "feel" actually arrives: a person looks at a rectangle with four
beds in it and knows immediately whether they can walk between them.
Deliberately schematic, never a fake render — it is drawn from the owner's
measurements and must not imply detail Stayo has not verified.

**Nothing here needs the owner to do more than they did in phase 1.**

## Phase 3 — 360° capture

The literal request, and the right instrument for "what does it look like from
inside".

- **Capture**: an Insta360/Ricoh Theta, or a phone panorama in a pinch. Stayo's
  own team can shoot these for platform-listed hostels; owners with a camera
  can upload their own.
- **Storage**: a new `kind: "photo360"` on the existing media array — so it
  inherits ordering, captions, categories, the review cycle and the photo tour
  for free, exactly as `video` did.
- **Rendering**: an equirectangular sphere in WebGL. Dynamically imported, so
  the ~150KB viewer never loads for the 99% of visits that do not open one,
  and only ever inside the photo tour or the full-screen viewer — never on a
  card, never on the listing hero.
- **Fallbacks that must exist**: a flat still for the card and the share
  preview (a 360 cannot be an `og:image`), and a plain scroll-to-look control
  for devices without WebGL or a gyroscope.

Sequenced third because it is the most expensive and the least comparable: a
beautiful 360 of one hostel does not help someone choose between two.

## Phase 4 — only if 1–3 land

Measuring against the viewer's own space ("hold your phone up in your current
room") and AR placement. Named here so it is visibly *not* in scope: it
depends on device capability Stayo cannot assume and answers a question phases
1–2 already answer more cheaply.

## What I would build first

Phase 1, end to end, for one hostel. The per-bed area figure is the highest
information-per-byte thing on this whole list, and it is a migration, a form
and a paragraph — no viewer, no WebGL, no new camera.
