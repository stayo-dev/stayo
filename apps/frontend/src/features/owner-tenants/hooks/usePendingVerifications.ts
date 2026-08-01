import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { tenantService } from '@features/tenants/api';
import { queryKeys } from '@lib/queryKeys';
import { groupPendingByTenant, type PendingTenantGroup } from '../documents/kycDocuments';

/**
 * The owner's pending-KYC queue.
 *
 * `GET /api/tenants/pending-documents` is already owner-scoped and already
 * filters to the document types that tenant's profile actually requires, so no
 * hostel id is passed — the queue is deliberately portfolio-wide, matching the
 * Home dashboard's count, which is a sum across every hostel. Passing
 * `primaryHostelId` here would silently show a multi-hostel owner only their
 * first hostel's backlog while Home kept counting all of them.
 *
 * Shares its query key with the dashboard, so approving a document updates
 * both surfaces from one invalidation.
 */
export function usePendingVerifications() {
  const session = useOwnerSession();

  const query = useQuery({
    queryKey: queryKeys.owner.pendingDocuments(),
    queryFn: () => tenantService.getPendingDocuments(),
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  const groups: PendingTenantGroup[] = useMemo(
    () => groupPendingByTenant(query.data),
    [query.data],
  );

  const documentCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.documents.length, 0),
    [groups],
  );

  return {
    groups,
    documentCount,
    tenantCount: groups.length,
    isLoading: session.isLoading || query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
