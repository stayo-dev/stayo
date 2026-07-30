import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import type { FoodScheduleRow } from './useFoodSchedule';

export interface FoodScheduleHistoryEntry {
  id: string;
  month: string;
  status: 'PUBLISHED';
  published_at: string;
}

/** Past published months for a hostel, plus an on-demand read-only fetch of one selected month's full schedule. */
export function useFoodScheduleHistory(hostelId: string | undefined) {
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ['owner', 'food', 'schedule-history', hostelId],
    queryFn: () => foodService.getScheduleHistory(hostelId!) as Promise<FoodScheduleHistoryEntry[]>,
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });

  const detailQuery = useQuery({
    queryKey: ['owner', 'food', 'schedule-history-detail', hostelId, openMonth],
    queryFn: () => foodService.getSchedule(hostelId!, openMonth!.slice(0, 7)) as Promise<FoodScheduleRow | null>,
    enabled: Boolean(hostelId && openMonth),
    staleTime: 60_000,
  });

  return {
    isLoading: historyQuery.isLoading,
    months: historyQuery.data ?? [],
    openMonth,
    toggleMonth: (month: string) => setOpenMonth((m) => (m === month ? null : month)),
    detail: detailQuery.data ?? null,
    isLoadingDetail: detailQuery.isLoading,
  };
}
