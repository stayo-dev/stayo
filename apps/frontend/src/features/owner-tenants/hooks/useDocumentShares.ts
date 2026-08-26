import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { documentShareService } from '../api/documentShares';

/**
 * The vault review queue for one tenant at one hostel.
 *
 * Returns an empty list rather than failing the page when the endpoint is
 * unavailable or the hostel has never used the vault: this section is additive
 * to the Documents tab, and a hostel that does not use vault sharing should
 * see the tab exactly as before rather than an error.
 */
export function useDocumentShares(hostelId: string | undefined, profileId: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(hostelId) && Boolean(profileId);

  const query = useQuery({
    queryKey: ['owner', 'document-shares', hostelId, profileId],
    queryFn: () => documentShareService.listForTenant(hostelId!, profileId!),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['owner', 'document-shares', hostelId, profileId] });

  const decide = useMutation({
    mutationFn: ({
      shareId,
      verdict,
      reason,
    }: {
      shareId: string;
      verdict: 'VERIFIED' | 'REJECTED';
      reason?: string;
    }) => documentShareService.setVerdict(shareId, verdict, reason),
    onSuccess: (_result, variables) => {
      stayoToast.success(
        variables.verdict === 'VERIFIED'
          ? 'Document accepted for this hostel'
          : 'Document sent back — the tenant has been told why',
      );
      invalidate();
    },
    onError: (error: any) =>
      stayoToast.error(
        error?.response?.data?.error?.message || 'Could not record that decision.',
      ),
  });

  return {
    shares: query.data ?? [],
    isLoading: query.isLoading && enabled,
    decide,
  };
}
