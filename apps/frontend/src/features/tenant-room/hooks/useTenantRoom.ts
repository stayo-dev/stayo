import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantRoomService, type ServiceRequestType } from '@features/tenant-room/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';

/** Tenant Room tab — room/roommates/utility-status/house-rules + the tenant's own service requests. */
export function useTenantRoom() {
  const session = useTenantSession();
  const queryClient = useQueryClient();

  const roomQuery = useQuery({
    queryKey: ['tenant', 'room'],
    queryFn: () => tenantRoomService.getRoom(),
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  const requestsQuery = useQuery({
    queryKey: ['tenant', 'service-requests'],
    queryFn: () => tenantRoomService.getServiceRequests(),
    enabled: session.isAuthenticated,
    staleTime: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: { type: ServiceRequestType; category?: string; description?: string }) =>
      tenantRoomService.createServiceRequest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', 'service-requests'] });
    },
  });

  const openRequests = useMemo(
    () => (requestsQuery.data ?? []).filter((r) => r.status !== 'RESOLVED' && r.status !== 'REJECTED'),
    [requestsQuery.data],
  );
  const activeTicket = useMemo(
    () => openRequests.find((r) => r.type === 'MAINTENANCE') ?? null,
    [openRequests],
  );

  return {
    isLoading: roomQuery.isLoading || requestsQuery.isLoading,
    room: roomQuery.data?.room ?? null,
    roommates: roomQuery.data?.roommates ?? [],
    utilityStatus: roomQuery.data?.utilityStatus ?? [],
    houseRules: roomQuery.data?.houseRules ?? [],
    requests: requestsQuery.data ?? [],
    openRequests,
    activeTicket,
    hasOpenComplaint: openRequests.length > 0,
    latestOpenRequest: openRequests[0] ?? null,
    createRequest: (data: { type: ServiceRequestType; category?: string; description?: string }) => createMutation.mutateAsync(data),
    isCreating: createMutation.isPending,
  };
}
