import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { stayApi } from '@features/stay/api';
import type { StayEventInput } from '@features/stay/types';

/** Owner Home's Tonight answers — portfolio-wide. */
export function useStaySummary() {
  return useQuery({ queryKey: queryKeys.stay.summary(), queryFn: stayApi.getSummary, staleTime: 60_000 });
}

/** One hostel's Stay board. */
export function useStayBoard(hostelId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.stay.board(hostelId),
    queryFn: () => stayApi.getBoard(hostelId as string),
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });
}

/** The owner updating a resident's stay (source OWNER). Refreshes the board and Home. */
export function useOwnerStayAction(hostelId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, input }: { tenantId: string; input: StayEventInput }) =>
      stayApi.recordForResident(hostelId as string, tenantId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.board(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.summary() });
    },
  });
}
