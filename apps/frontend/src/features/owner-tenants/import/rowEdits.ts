/**
 * Fixing a row without leaving the screen.
 *
 * Most of what an import gets wrong is small — a phone missing a digit, a room
 * picked from the wrong hostel, a date the spreadsheet mangled. Sending the
 * owner back to Excel for those is the difference between a five-minute job
 * and an afternoon, so the review screen edits them in place and re-checks.
 *
 * Edits are held apart from the rows they amend, so the original upload stays
 * intact, "what did I change?" is answerable, and re-checking is a single
 * merge rather than a mutation trail.
 */

import type { QueueRow, ReviewQueue } from './reviewQueue';

/** row number → field → new value. */
export type RowEdits = Record<number, Record<string, string>>;

export function editRow(edits: RowEdits, row: number, field: string, value: string): RowEdits {
  const forRow = { ...(edits[row] ?? {}), [field]: value };
  return { ...edits, [row]: forRow };
}

/** What the owner has typed for this row's field, or what was there before. */
export function valueFor(edits: RowEdits, row: QueueRow, field: string): string {
  const edited = edits[row.row]?.[field];
  if (edited !== undefined) return edited;
  const original = row.data?.[field];
  return original === undefined || original === null ? '' : String(original);
}

export function editCount(edits: RowEdits): number {
  return Object.values(edits).reduce((sum, fields) => sum + Object.keys(fields).length, 0);
}

export function hasEdits(edits: RowEdits): boolean {
  return editCount(edits) > 0;
}

/**
 * Every row of the batch with the owner's edits applied, in the shape
 * `revalidate` takes — it re-runs the whole batch, not a diff, so rows the
 * owner never touched have to travel too or they would be dropped.
 */
export function mergeEdits(queue: ReviewQueue, edits: RowEdits): Array<Record<string, unknown>> {
  const all = [...queue.ready, ...queue.needsYou, ...queue.duplicates];
  return all
    .slice()
    .sort((a, b) => a.row - b.row)
    .map((row) => {
      const forRow = edits[row.row];
      if (!forRow) return { ...row.data };
      const merged: Record<string, unknown> = { ...row.data };
      for (const [field, value] of Object.entries(forRow)) {
        // An emptied field means "no value", not the string "".
        merged[field] = value.trim() === '' ? undefined : value;
      }
      return merged;
    });
}

/**
 * Whether a row still shows a problem the owner has since typed over.
 *
 * The issue list comes from the server and does not move until the next
 * re-check, so a row the owner has just fixed would otherwise keep shouting at
 * them. This marks it as touched instead.
 */
export function isEdited(edits: RowEdits, row: QueueRow, field?: string | null): boolean {
  const forRow = edits[row.row];
  if (!forRow) return false;
  return field ? forRow[field] !== undefined : Object.keys(forRow).length > 0;
}
