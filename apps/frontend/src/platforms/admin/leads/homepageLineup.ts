/** Mirrors MAX_FEATURED in the backend's homepage-curation.ts. */
export const MAX_FEATURED = 12;

/**
 * Move one entry of an ordered list to another index.
 *
 * Returns the list untouched when the move would go out of bounds, so the
 * caller does not have to guard every button — a disabled control and a no-op
 * should agree.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
