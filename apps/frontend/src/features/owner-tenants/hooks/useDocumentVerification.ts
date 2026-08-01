import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import { queryKeys } from '@lib/queryKeys';
import { stayoToast } from '@shared/ui-patterns/Toast';

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Approve / reject a tenant's KYC document.
 *
 * Both call endpoints that already existed (`PATCH …/documents/:docId/verify`
 * and `…/reject`) — this hook exists for the *invalidation*, which is the part
 * that makes the result visible everywhere at once. Approving the last
 * required document flips `tenants.document_verified`, which four separate
 * surfaces derive from:
 *
 *   - Tenant Detail's KYC pill and Risk & Compliance tile
 *   - the Tenants list ("Docs Pending" vs "Active")
 *   - the Home dashboard's "Verify KYC" count and bell badge
 *   - the pending-verifications queue itself
 *
 * Missing any one of them leaves the owner staring at a number that no longer
 * matches what they just did, so all four are invalidated together.
 */
export function useDocumentVerification(tenantId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.owner.pendingDocuments() });
    queryClient.invalidateQueries({ queryKey: ['owner', 'tenants', 'list-merged'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
    if (tenantId) {
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
    }
  };

  const approveMutation = useMutation({
    mutationFn: ({ documentId, targetTenantId }: { documentId: string; targetTenantId?: string }) =>
      tenantService.verifyDocument(targetTenantId ?? tenantId, documentId),
    onSuccess: () => {
      stayoToast.success('Document approved');
      invalidateAll();
    },
    onError: (error) => stayoToast.error(getErrorMessage(error, 'Could not approve this document.')),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ documentId, reason, targetTenantId }: { documentId: string; reason: string; targetTenantId?: string }) =>
      tenantService.rejectDocument(targetTenantId ?? tenantId, documentId, reason.trim()),
    onSuccess: () => {
      // The reason is what the tenant actually sees on their Documents screen —
      // say so, rather than a bare "Rejected".
      stayoToast.success('Document rejected — the tenant has been told why');
      invalidateAll();
    },
    onError: (error) => stayoToast.error(getErrorMessage(error, 'Could not reject this document.')),
  });

  return {
    approve: approveMutation.mutate,
    isApproving: approveMutation.isPending,
    approvingId: approveMutation.isPending ? approveMutation.variables?.documentId : undefined,
    reject: rejectMutation.mutate,
    rejectAsync: rejectMutation.mutateAsync,
    isRejecting: rejectMutation.isPending,
  };
}
