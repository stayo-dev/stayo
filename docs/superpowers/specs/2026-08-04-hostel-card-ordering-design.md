# Hostel card ordering & sorting — design

**Date:** 2026-08-04 · **Status:** Approved, implementing

## Problem

The owner Home "Property" section renders a `⠿` drag handle on every hostel card, but dragging does nothing. Investigation found the feature was never built: `react-dnd` and `react-dnd-html5-backend` are in `package.json` but **imported nowhere** in `src/`, there is no `DndProvider` mounted anywhere, and `DragHandle` is a decorative `<span aria-hidden="true">` with no event handlers. The handle is a visual affordance carried over from the Figma source. `hostels` also has no ordering column, so no order could have been stored even if the drag worked.

Separately, even wired up, `react-dnd-html5-backend` does not fire on touch devices — the HTML5 drag-and-drop API is desktop-only.

## Goal

Give the owner real control over property order — both manual ("give this hostel importance for a while") and metric-driven ("show me who owes the most").

## Design

### Interaction

Section header gains a sort control:

```
PROPERTY          Sort: Custom ▾        + Add hostel
```

Modes: **Custom** (default) · Dues · Occupancy · Revenue · Name.

- Drag is live **only in Custom mode**. In metric modes the handle is hidden, so there is never a dead affordance — the exact failure being fixed.
- Switching to a metric mode and back leaves the custom arrangement untouched.
- **Drag initiates from the handle only**, never the card body. This preserves both the card's tap-to-drill and vertical page scroll, which is what makes it usable on touch.

### Backend

```
hostels.display_order  Int?    // nullable; NULL sorts last, then name asc
PATCH /api/owner/hostels/reorder   body: { order: ["<hostelId>", ...] }
```

- Owner-scoped; rejects any id not owned by the caller.
- Writes all positions in one transaction.
- Nullable with no backfill — existing hostels keep today's name-ascending order until the owner drags something.
- `portfolio-service.ts` selects `display_order`, orders by it (nulls last, then `name asc`), and returns it on each hostel card.

### Frontend

- **No new dependency.** `motion` is already installed and used in `TenantCard.tsx`; `motion/react` exports `Reorder` and `useDragControls`, giving handle-only drag plus reorder animation.
- **Remove `react-dnd` and `react-dnd-html5-backend`** — unused.
- `DragHandle` gains an `interactive` prop: a real `<button>` with `aria-label` when set, unchanged decorative `<span>` otherwise. Its three other call sites (floor groups, room layout, food poll options) stay decorative — those are separate unbuilt features and should not imply they work.
- Sort mode is view state → `localStorage`. The order is owner intent → server.
- Reorder persists optimistically, then invalidates the portfolio query key.

### Accessibility

Drag alone is unusable by keyboard and screen reader. The existing `HostelOptionsSheet` (⋮ menu) gains **Move up / Move down**, hitting the same endpoint. Doubles as the escape hatch when drag is fiddly on a small screen.

### Card polish

- Occupancy pill **tones by threshold** — currently always `success`, so 75% and 88% render identically green and the pill carries no signal.
- Dues emphasised only when non-zero.
- Tighten the `ml-8` indent that exists only to clear the handle.

## Out of scope

Cross-surface ordering (the Tenants "All Hostels" dropdown keeps its own order), drag between hostels, pinning as a concept distinct from ordering, and server-persisted sort mode.

## Testing

- Backend: reorder endpoint — happy path, cross-owner rejection, unknown id rejection, partial-list rejection, transaction atomicity.
- Frontend: pure sort/comparator module — every mode, nulls-last behaviour, stable tie-breaking, move-up/move-down index math.
