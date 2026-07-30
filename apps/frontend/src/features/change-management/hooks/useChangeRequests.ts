import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { changeRequestService, type ChangeRequestListParams } from '../api';

/** Query key factory for change-request queries */
export const changeRequestKeys = {
  all: () => ['change-requests'] as const,
  list: (params?: ChangeRequestListParams) => ['change-requests', 'list', params ?? {}] as const,
  detail: (id: string) => ['change-requests', 'detail', id] as const,
  forTenant: (tenantId: string) => ['change-requests', 'tenant', tenantId] as const,
};

/**
 * Fetch change requests with optional filters.
 * Returns { requests, total, pendingCount, isLoading }.
 */
export function useChangeRequests(params: ChangeRequestListParams = {}) {
  const query = useQuery({
    queryKey: changeRequestKeys.list(params),
    queryFn: () => changeRequestService.list(params),
    staleTime: 30_000,
  });

  const requests = query.data?.requests ?? [];
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  return {
    requests,
    total: query.data?.total ?? 0,
    pendingCount,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Fetch pending change requests for a specific tenant.
 * Used on the tenant profile page to show the pending banner.
 */
export function useTenantChangeRequests(tenantId: string) {
  const query = useQuery({
    queryKey: changeRequestKeys.forTenant(tenantId),
    queryFn: () => changeRequestService.list({ tenantId, limit: 50 }),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const requests = query.data?.requests ?? [];
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const recentChanges = requests.slice(0, 5);

  return {
    requests,
    pendingCount,
    recentChanges,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * Fetch a single change request with full timeline.
 */
export function useChangeRequestDetail(id: string) {
  return useQuery({
    queryKey: changeRequestKeys.detail(id),
    queryFn: () => changeRequestService.getById(id),
    enabled: Boolean(id),
  });
}

/**
 * Cancel a pending change request (owner action).
 */
export function useCancelChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      changeRequestService.cancel(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: changeRequestKeys.all() });
    },
  });
}

/**
 * Approve a pending change request (tenant action).
 */
export function useApproveChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      changeRequestService.approve(id, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: changeRequestKeys.all() });
    },
  });
}

/**
 * Reject a pending change request (tenant action).
 */
export function useRejectChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      changeRequestService.reject(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: changeRequestKeys.all() });
    },
  });
}
