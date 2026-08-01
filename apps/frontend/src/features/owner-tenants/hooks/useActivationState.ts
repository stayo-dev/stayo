import { useQuery } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import type { ActivationStateLike } from '../activation/activationProgress';

/**
 * One tenant's activation state, for the owner.
 *
 * Backed by `GET /api/tenants/:id/activation-state`, which reuses the same
 * `computeState()` the tenant's activation wizard runs on. Shares its query
 * key with `usePendingActivations`, so a tenant finishing activation updates
 * both Tenant Detail and the Pending Activations queue from one invalidation.
 *
 * Only fetched while the tenant is still onboarding — an activated tenant has
 * no step left to report.
 */
export function useActivationState(tenantId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['owner', 'tenant', tenantId, 'activation-state'],
    queryFn: () => tenantService.getActivationState(tenantId) as Promise<ActivationStateLike>,
    enabled: Boolean(tenantId) && enabled,
    staleTime: 30_000,
    retry: false,
  });

  return {
    state: (query.data as ActivationStateLike | undefined) ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
