import { useQuery } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import { paymentService } from '@features/payments/api';
import { allocationService } from '@features/rooms/api';
import { queryKeys } from '@lib/queryKeys';

export function useTenantProfile(hostelId: string, tenantId: string, section?: string) {
  const overviewQuery = useQuery({
    queryKey: queryKeys.tenants.overview(hostelId, tenantId),
    queryFn: () => tenantService.getOwnerTenantOverview(tenantId),
    enabled: Boolean(hostelId && tenantId),
    staleTime: 60_000,
  });

  const fullQuery = useQuery({
    queryKey: queryKeys.tenants.full(hostelId, tenantId),
    queryFn: () => tenantService.getFull(tenantId),
    enabled: Boolean(hostelId && tenantId),
    staleTime: 60_000,
  });

  const allocationsQuery = useQuery({
    queryKey: queryKeys.tenants.allocations(hostelId, tenantId),
    queryFn: () => allocationService.getTenantHistory(tenantId, hostelId),
    enabled: Boolean(hostelId && tenantId),
    staleTime: 60_000,
  });

  const duesQuery = useQuery({
    queryKey: queryKeys.tenants.obligations(hostelId, tenantId),
    queryFn: () => paymentService.getTenantDues(tenantId, hostelId),
    enabled: Boolean(hostelId && tenantId),
    staleTime: 60_000,
  });

  const advanceQuery = useQuery({
    queryKey: queryKeys.tenants.advance(hostelId, tenantId),
    queryFn: () => tenantService.getFinancialLedger(tenantId),
    enabled: Boolean(hostelId && tenantId),
    staleTime: 60_000,
  });

  const financialTimelineQuery = useQuery({
    queryKey: queryKeys.tenants.financialTimeline(hostelId, tenantId),
    queryFn: () => tenantService.getFinancialTimeline(tenantId, hostelId),
    enabled: Boolean(hostelId && tenantId),
    staleTime: 30_000,
  });

  return {
    overview: overviewQuery.data,
    full: fullQuery.data,
    allocations: allocationsQuery.data,
    dues: duesQuery.data,
    advance: advanceQuery.data,
    financialTimeline: financialTimelineQuery.data,
    isLoading: overviewQuery.isLoading,
    isError: overviewQuery.isError,
    refetch: () => {
      overviewQuery.refetch();
      fullQuery.refetch();
      allocationsQuery.refetch();
      duesQuery.refetch();
      advanceQuery.refetch();
      financialTimelineQuery.refetch();
    },
  };
}
