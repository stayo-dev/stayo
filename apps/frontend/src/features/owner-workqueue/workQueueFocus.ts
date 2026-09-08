import type { WorkQueueItem, WorkQueueSection } from './WorkQueue';

/**
 * The queue row the desktop master-detail's `?focus=<id>` query param points at,
 * or `null`.
 *
 * The work-queue routes are deliberately untouched by the desktop conversion
 * ([[Decisions#ADR-171|ADR-171]] Phase 2, "Do NOT touch the routes"), so the
 * master-detail selection lives in the query string rather than a nested route.
 * A stale id — the row was cleared by an action, or the link is for a different
 * queue — resolves to `null`, which the pane renders as its empty state.
 */
export function findFocusedItem(
  sections: WorkQueueSection[],
  focusId: string | null | undefined,
): WorkQueueItem | null {
  if (!focusId) return null;
  for (const section of sections) {
    for (const item of section.items) {
      if (item.id === focusId) return item;
    }
  }
  return null;
}
