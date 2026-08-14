import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerProfileRequestsService } from '../api';

const QUERY_KEY = ['owner', 'profile-requests'] as const;

export function useOwnerProfileRequests() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => ownerProfileRequestsService.list('PENDING'),
    staleTime: 15_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => ownerProfileRequestsService.approve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => ownerProfileRequestsService.reject(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    isLoading: query.isLoading,
    requests: query.data ?? [],
    approve: (id: string) => approveMutation.mutateAsync(id),
    isApproving: approveMutation.isPending,
    reject: (id: string, reason?: string) => rejectMutation.mutateAsync({ id, reason }),
    isRejecting: rejectMutation.isPending,
  };
}
