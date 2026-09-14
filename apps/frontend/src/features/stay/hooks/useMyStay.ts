import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { stayApi } from '../api';
import type { MyStay, TenantStayEventInput } from '../types';

/** The signed-in tenant's stay, and the one way to change it. */
export function useMyStay(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.stay.mine(), queryFn: stayApi.getMine, enabled, staleTime: 15_000 });
  const mutation = useMutation({
    mutationFn: (input: TenantStayEventInput) => stayApi.record(input),
    // The server answers with the new stay: write it straight into the cache
    // so the screen changes on the frame the answer lands. No refetch.
    onSuccess: (stay) => {
      queryClient.setQueryData<MyStay>(queryKeys.stay.mine(), (prev) => (prev ? { ...prev, stay } : prev));
    },
  });
  return {
    mine: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    record: mutation.mutateAsync,
    isRecording: mutation.isPending,
  };
}
