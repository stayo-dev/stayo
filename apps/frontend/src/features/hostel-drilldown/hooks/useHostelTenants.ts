import { useQuery } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import { normalizeTenants } from '@features/tenants/utils/normalize';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { toTenantListItem } from '@features/owner-tenants/hooks/useRealTenantList';
import type { MockTenant } from '@shared/mocks/tenants';

/** Real tenant list for one hostel — Hostel Drill-down's Tenants sub-tab, mirroring useHostelRooms's pattern. */
export function useHostelTenants(hostelId: string | undefined) {
  const session = useOwnerSession();
  const hostelName = session.hostels.find((h) => h.id === hostelId)?.name ?? '';

  const query = useQuery<MockTenant[]>({
    queryKey: ['hostel', hostelId, 'tenants'],
    queryFn: async () => {
      const raw = await tenantService.getAll(hostelId as string, {});
      return normalizeTenants(raw).map((t) => toTenantListItem(t, hostelId as string, hostelName));
    },
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  return {
    tenants: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
