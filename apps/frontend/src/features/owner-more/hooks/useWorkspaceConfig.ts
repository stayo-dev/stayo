import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { portfolioService } from '@features/dashboard/api';
import { queryKeys } from '@lib/queryKeys';

export interface WorkspaceConfigItem {
  id: string;
  label: string;
  caption: string;
  done: boolean;
  route: string | null;
}

interface PortfolioSummary {
  aggregate?: { active_tenants: number };
  hostels?: unknown[];
}

/**
 * Real completion checklist for More → Workspace Configuration. Composes
 * hostel identity + billing policy (useHostelPolicy, same source as the
 * Hostel Identity / Rent & Billing screens) and the owner portfolio summary
 * (same endpoint/query key as the Home dashboard, so it's cache-shared) —
 * no invented/mock figures.
 */
export function useWorkspaceConfig() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio.summary(),
    queryFn: () => portfolioService.getSummary() as Promise<PortfolioSummary>,
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const isLoading = policyQuery.isLoading || portfolioQuery.isLoading;

  const hostel = policyQuery.data?.hostel;
  const billing = policyQuery.data?.policy?.billing;
  const activeTenants = portfolioQuery.data?.aggregate?.active_tenants ?? 0;
  const hostelsCount = portfolioQuery.data?.hostels?.length ?? 0;

  const items: WorkspaceConfigItem[] = [
    {
      id: 'hostel_identity',
      label: 'Hostel identity',
      caption: 'Name, phone & address',
      done: Boolean(hostel?.name && hostel?.phone && hostel?.address),
      route: '/owner/more/hostel',
    },
    {
      id: 'billing_policy',
      label: 'Rent & billing policy',
      caption: 'Late fee rules configured',
      done: Boolean(billing?.late_fee?.enabled),
      route: '/owner/more/billing',
    },
    {
      id: 'properties',
      label: 'At least one property',
      caption: `${hostelsCount} hostel${hostelsCount === 1 ? '' : 's'} added`,
      done: hostelsCount > 0,
      route: null,
    },
    {
      id: 'agreements',
      label: 'At least one active agreement',
      caption: `${activeTenants} active tenant${activeTenants === 1 ? '' : 's'}`,
      done: activeTenants > 0,
      route: '/owner/tenants',
    },
  ];

  const doneCount = items.filter((item) => item.done).length;
  const percentComplete = isLoading ? 0 : Math.round((doneCount / items.length) * 100);
  const remainingCount = items.length - doneCount;

  return { items, percentComplete, remainingCount, isLoading };
}
