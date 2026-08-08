import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { configApi } from '../api/configApi';

export interface ConfigChangeEntry {
  id: string;
  label: string;
  module: string;
  at: string;
  actor: { name: string; is_you: boolean };
}

/**
 * Recent configuration changes for the hub timeline.
 *
 * Fails soft on purpose: this is a history panel, so an error here should leave
 * the rest of the hub — progress, attention items, modules — perfectly usable.
 * The component renders nothing for an empty list.
 */
export function useConfigChanges(limit = 8) {
  const session = useOwnerSession();

  const query = useQuery({
    queryKey: ['owner', 'config-changes', limit],
    queryFn: () => configApi.getRecentChanges(limit),
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  return { changes: query.data ?? [], isLoading: query.isLoading };
}
