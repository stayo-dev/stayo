import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantRoomService, type ServiceRequestType } from '@features/tenant-room/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';

/** Tenant Room tab — room/roommates/facilities/house-rules + the tenant's own service requests. */
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
  /** Most recently raised open request, of any type — not maintenance-only, so a room-change/cleaning/etc. request still surfaces on Room's inline ticket card. See `openRequests` for the full set (Room's "view all tickets" list). */
  const activeTicket = useMemo(
    () => [...openRequests].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null,
    [openRequests],
  );

  return {
    isLoading: roomQuery.isLoading || requestsQuery.isLoading,
    room: roomQuery.data?.room ?? null,
    roommates: roomQuery.data?.roommates ?? [],
    /**
     * The hostel's APPROVED marketing amenities — the same list Discovery
     * publishes, so a tenant and a prospective tenant read the same facts.
     */
    facilities: roomQuery.data?.facilities ?? [],
    hostel: roomQuery.data?.hostel ?? { name: null, public_slug: null },
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
