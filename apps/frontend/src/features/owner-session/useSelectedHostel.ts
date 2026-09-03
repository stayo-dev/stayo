import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useOwnerSession } from './useOwnerSession';
import { resolveSelectedHostel, SELECTED_HOSTEL_STORAGE_KEY } from './selectedHostel';

function readStored(): string | null {
  try {
    return localStorage.getItem(SELECTED_HOSTEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) localStorage.setItem(SELECTED_HOSTEL_STORAGE_KEY, id);
    else localStorage.removeItem(SELECTED_HOSTEL_STORAGE_KEY);
  } catch {
    /* private mode / blocked storage — the URL still carries the id */
  }
}

/**
 * The owner desktop hostel context. Reads the current hostel from the route
 * (`:hostelId` → `?hostelId=` → stored → "All hostels"), against the hostels the
 * owner actually owns (`useOwnerSession`, the one blessed source).
 *
 * `selectHostel(id)`:
 *  - `null` → sets `?hostelId=` cleared, "All hostels"
 *  - an id  → sets `?hostelId=<id>` (a global screen re-scopes in place)
 *  It never touches a `:hostelId` path segment — a hostel-scoped screen that
 *  lives at `/owner/hostels/:hostelId/...` navigates itself; this hook only owns
 *  the query-param channel and the stored fallback.
 *
 * Introduced in Phase 0; wired into the sidebar in Phase 1.
 */
export function useSelectedHostel() {
  const params = useParams<{ hostelId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hostels, isLoading } = useOwnerSession();

  const selectedHostelId = resolveSelectedHostel({
    paramId: params.hostelId ?? null,
    queryId: searchParams.get('hostelId'),
    storedId: readStored(),
    ownedHostelIds: hostels.map((h) => h.id),
  });

  const selectHostel = useCallback(
    (id: string | null) => {
      writeStored(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('hostelId', id);
          else next.delete('hostelId');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    hostels,
    isLoading,
    selectedHostelId,
    selectedHostel: hostels.find((h) => h.id === selectedHostelId) ?? null,
    /** True while a `:hostelId` path segment pins the context (switcher is read-only then). */
    pinnedByRoute: Boolean(params.hostelId),
    selectHostel,
  };
}
