import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import { dashboardService } from '@features/dashboard/api';
import { queryKeys } from '@lib/queryKeys';
import { useTenantStore, type LifecycleFilter } from '@features/tenants/store/tenantStore';
import { normalizeTenants, INACTIVE_STATUSES, type NormalizedTenant } from '@features/tenants/utils/normalize';

function applyLifecycleFilter(tenants: NormalizedTenant[], filter: LifecycleFilter): NormalizedTenant[] {
  switch (filter) {
    case 'active':
      return tenants.filter((t) => t.status === 'ACTIVE');
    case 'invited':
      return tenants.filter((t) => t.status === 'INVITED');
    case 'move_out':
      return tenants.filter((t) => t.status === 'MOVE_OUT_REQUESTED');
    case 'overdue':
      return tenants.filter(
        (t) => String(t.paymentStatus).toUpperCase() === 'OVERDUE'
      );
    case 'unverified':
      return tenants.filter((t) => !t.documentVerified && t.status === 'ACTIVE');
    case 'no_room':
      return tenants.filter((t) => t.room === 'N/A' && t.status === 'ACTIVE');
    case 'inactive':
      return tenants.filter((t) => INACTIVE_STATUSES.includes(t.status as (typeof INACTIVE_STATUSES)[number]));
    default:
      return tenants;
  }
}

export function useTenantsList(hostelId: string | undefined, options?: { enabled?: boolean }) {
  const searchQuery = useTenantStore((s) => s.searchQuery);
  const lifecycleFilter = useTenantStore((s) => s.lifecycleFilter);
  const showInactive = useTenantStore((s) => s.showInactive);
  const page = useTenantStore((s) => s.page);
  const pageSize = useTenantStore((s) => s.pageSize);

  const listQuery = useQuery({
    queryKey: queryKeys.tenants.list(hostelId ?? '', {
      search: searchQuery,
      page,
      pageSize,
      showInactive,
    }),
    queryFn: () =>
      tenantService.getAll(hostelId!, {
        search: searchQuery || undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
    enabled: Boolean(hostelId) && (options?.enabled !== false),
    staleTime: 60_000,
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.tenants.dashboard(hostelId ?? ''),
    queryFn: () => dashboardService.getStats(hostelId!),
    enabled: Boolean(hostelId),
    staleTime: 120_000,
  });

  const invitedQuery = useQuery({
    queryKey: queryKeys.tenants.list(hostelId ?? '', { status: 'INVITED', count: true }),
    queryFn: () => tenantService.getAll(hostelId!, { status: 'INVITED', limit: 1 }),
    enabled: Boolean(hostelId),
    staleTime: 120_000,
  });

  const moveOutQuery = useQuery({
    queryKey: queryKeys.tenants.list(hostelId ?? '', { status: 'MOVE_OUT_REQUESTED', count: true }),
    queryFn: () => tenantService.getAll(hostelId!, { status: 'MOVE_OUT_REQUESTED', limit: 1 }),
    enabled: Boolean(hostelId),
    staleTime: 120_000,
  });

  const allNormalized = useMemo(
    () => normalizeTenants(listQuery.data),
    [listQuery.data]
  );

  const filtered = useMemo(() => {
    let list = allNormalized;
    if (!showInactive && lifecycleFilter === 'all') {
      list = list.filter(
        (t) => !INACTIVE_STATUSES.includes(t.status as (typeof INACTIVE_STATUSES)[number])
      );
    }
    return applyLifecycleFilter(list, lifecycleFilter);
  }, [allNormalized, lifecycleFilter, showInactive]);

  const total = Number((listQuery.data as Record<string, unknown>)?.total ?? filtered.length);
  const stats = statsQuery.data as Record<string, unknown> | undefined;
  const loadedOverdueTenants = allNormalized.filter(
    (t) =>
      t.status === 'ACTIVE' &&
      t.outstandingAmount > 0 &&
      ['PENDING', 'PARTIAL'].includes(String(t.paymentStatus).toUpperCase())
  ).length;

  const dashboard = {
    total: Number(stats?.total_tenants ?? stats?.totalTenants ?? total),
    active: Number(stats?.active_tenants ?? stats?.activeTenants ?? 0),
    pendingInvites: Number(
      (invitedQuery.data as Record<string, unknown>)?.total ??
        invitedQuery.data?.tenants?.length ??
        0
    ),
    moveOutRequests: Number(
      (moveOutQuery.data as Record<string, unknown>)?.total ??
        moveOutQuery.data?.tenants?.length ??
        0
    ),
    occupancyRate: Number(stats?.occupancy_rate ?? stats?.occupancyRate ?? 0),
    pendingDues: Number(stats?.pending_dues ?? stats?.pendingDues ?? 0),
    overdueTenants: Number(
      stats?.overdue_tenants ??
        stats?.overdueTenants ??
        stats?.overdue_count ??
        stats?.overdueCount ??
        loadedOverdueTenants
    ),
  };

  return {
    tenants: filtered,
    total,
    dashboard,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    page,
    pageSize,
  };
}
