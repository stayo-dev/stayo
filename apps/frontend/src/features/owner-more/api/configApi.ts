import api from '@lib/api-client';
import type { ConfigChangeEntry } from '../hooks/useConfigChanges';

/**
 * Configuration-hub endpoints. This is the only layer allowed to know the
 * endpoint shape for this feature (scripts/check-architecture.mjs enforces that
 * everything reaches the network through `@lib/api-client`).
 */
export const configApi = {
  getRecentChanges: async (limit = 8): Promise<ConfigChangeEntry[]> => {
    const response = await api.get('/owner/config-changes', { params: { limit } });
    return (response.data?.changes ?? []) as ConfigChangeEntry[];
  },
};
