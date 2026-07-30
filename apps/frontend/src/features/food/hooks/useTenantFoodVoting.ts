import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';
import type { MealSlotKey } from '@shared/mocks/food';

export interface TenantFoodItem {
  id: string;
  name: string;
}

const QUERY_KEY = ['tenant', 'food', 'voting-period'] as const;

/**
 * Tenant-side voting — `GET /api/food/tenant/voting-period` (current open
 * period for the tenant's own hostel + their existing picks) and
 * `POST /api/food/tenant/vote` (toggles one item's vote — tenants may select
 * multiple items per meal type, collective preferences feed the generator).
 */
export function useTenantFoodVoting() {
  const session = useTenantSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => foodService.getTenantVotingPeriod(),
    enabled: session.isAuthenticated,
    staleTime: 15_000,
  });

  const voteMutation = useMutation({
    mutationFn: ({ mealType, menuItemId }: { mealType: string; menuItemId: string }) => foodService.castTenantVote(mealType, menuItemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const period = query.data?.votingPeriod ?? null;

  const itemsBySlot: Record<MealSlotKey, TenantFoodItem[]> = useMemo(() => {
    const grouped: Record<MealSlotKey, TenantFoodItem[]> = { breakfast: [], lunch: [], snacks: [], dinner: [] };
    for (const item of query.data?.items ?? []) {
      const slot = String(item.meal_type).toLowerCase() as MealSlotKey;
      if (grouped[slot]) grouped[slot].push({ id: item.id, name: item.name });
    }
    return grouped;
  }, [query.data]);

  const myVotesBySlot: Record<MealSlotKey, Set<string>> = useMemo(() => {
    const map: Record<MealSlotKey, Set<string>> = { breakfast: new Set(), lunch: new Set(), snacks: new Set(), dinner: new Set() };
    for (const vote of query.data?.myVotes ?? []) {
      const slot = String(vote.meal_type).toLowerCase() as MealSlotKey;
      if (slot in map) map[slot].add(vote.menu_item_id);
    }
    return map;
  }, [query.data]);

  const now = Date.now();
  const isOpen = Boolean(
    period &&
      period.status === 'OPEN' &&
      now >= new Date(period.voting_starts_at).getTime() &&
      now <= new Date(period.voting_ends_at).getTime(),
  );

  return {
    isLoading: query.isLoading,
    period,
    isOpen,
    itemsBySlot,
    myVotesBySlot,
    toggleVote: (mealType: MealSlotKey, menuItemId: string) => voteMutation.mutate({ mealType: mealType.toUpperCase(), menuItemId }),
    isVoting: voteMutation.isPending,
    voteError: voteMutation.isError,
  };
}
