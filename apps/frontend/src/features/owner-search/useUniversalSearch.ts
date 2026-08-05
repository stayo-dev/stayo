import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ownerService } from '@features/owners/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { MIN_QUERY_LENGTH, viewState, type SearchResponse } from './searchActions';

/** Long enough to not fire per keystroke, short enough to feel instant. */
const DEBOUNCE_MS = 180;

export function useUniversalSearch(rawQuery: string) {
  const session = useOwnerSession();
  const [debounced, setDebounced] = useState(rawQuery.trim());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(rawQuery.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const enabled = session.isAuthenticated && debounced.length >= MIN_QUERY_LENGTH;

  const query = useQuery({
    // Keyed on the query only — search is owner-scoped server-side by session,
    // and there is no per-hostel variant to leak between.
    queryKey: ['owner', 'universal-search', debounced],
    queryFn: ({ signal }) => ownerService.universalSearch(debounced, 8, signal) as Promise<any>,
    enabled,
    staleTime: 30_000,
    // Keeps the previous results on screen while the next query resolves, so
    // the list doesn't blank out between keystrokes.
    placeholderData: (prev: unknown) => prev as any,
  });

  const data: SearchResponse | undefined = query.data?.data ?? query.data;
  const groups = data?.groups;

  // `debounced !== rawQuery.trim()` means the user has typed since the last
  // fetch — treat that as loading so the empty state can't flash.
  const isLoading = enabled && (query.isFetching || debounced !== rawQuery.trim());

  return {
    groups: groups ?? [],
    total: data?.total ?? 0,
    isLoading,
    isError: query.isError,
    state: viewState({ query: rawQuery, isLoading, groups }),
  };
}
