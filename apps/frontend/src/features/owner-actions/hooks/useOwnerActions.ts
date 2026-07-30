import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { ownerActionsService, type OwnerActionSummary } from '@features/owner-actions/api';

export function useOwnerActions(hostelId: string | undefined, tenantId: string | undefined) {
  const { data } = useQuery({
    queryKey: hostelId && tenantId ? queryKeys.tenants.ownerActions(hostelId, tenantId) : ['__noop__'],
    queryFn: () => ownerActionsService.listForTenant(tenantId as string),
    enabled: Boolean(hostelId && tenantId),
  });

  const actions: OwnerActionSummary[] = data ?? [];

  const findAction = (actionId: string) => actions.find((a) => a.actionId === actionId);

  return { actions, findAction };
}
