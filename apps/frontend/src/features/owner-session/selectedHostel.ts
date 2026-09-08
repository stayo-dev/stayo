/**
 * Which hostel the owner desktop shell is scoped to, resolved from the URL
 * first and storage only as a fallback.
 *
 * Precedence (highest wins):
 *   1. `:hostelId` route param  — a hostel-scoped screen (drilldown, per-hostel config)
 *   2. `?hostelId=` query param  — a global screen the owner filtered
 *   3. `localStorage` last-used  — carried between global screens
 *   4. `null` ("All hostels")    — the portfolio-wide default
 *
 * A stored/param id that the owner no longer owns is discarded (returns the
 * next candidate), so a deleted hostel can't strand the shell on a dead id.
 *
 * The URL stays authoritative on purpose — the backend's architectural
 * invariant is "never fall back to the first hostel", so an implicit current
 * hostel is a bug. The switcher writes the id into the route; this only reads it
 * back.
 */
export function resolveSelectedHostel({
  paramId,
  queryId,
  storedId,
  ownedHostelIds,
}: {
  paramId?: string | null;
  queryId?: string | null;
  storedId?: string | null;
  ownedHostelIds: string[];
}): string | null {
  const owned = new Set(ownedHostelIds);
  const candidates = [paramId, queryId, storedId];
  for (const id of candidates) {
    if (id && owned.has(id)) return id;
  }
  return null;
}

export const SELECTED_HOSTEL_STORAGE_KEY = 'stayo.owner.selectedHostelId';
