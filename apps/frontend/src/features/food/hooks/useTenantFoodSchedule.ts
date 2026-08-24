import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';
import type { MealSlotKey } from '@shared/mocks/food';
import type { WeekGridItem } from '@features/owner-food/weekGrid';

export const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type DayKey = (typeof DAY_ORDER)[number];

interface ScheduleMealCell {
  day_of_week: DayKey;
  meal_type: string;
  /** Ordered dishes, as returned by the API. */
  food_schedule_meal_items: WeekGridItem[];
  /** @deprecated legacy single-item snapshot — read `food_schedule_meal_items`/`formatCellItems` instead. */
  item_name: string;
}

type Grid = Record<DayKey, Partial<Record<MealSlotKey, ScheduleMealCell>>>;

export interface MonthSchedule {
  month: string;
  monthLabel: string;
  isCurrent: boolean;
  grid: Grid;
}

const EMPTY_GRID: Grid = Object.fromEntries(DAY_ORDER.map((d) => [d, {}])) as Grid;

function buildGrid(schedule: any): Grid {
  const map = { ...EMPTY_GRID };
  for (const meal of schedule?.food_schedule_meals ?? []) {
    const slot = meal.meal_type.toLowerCase() as MealSlotKey;
    map[meal.day_of_week as DayKey] = { ...map[meal.day_of_week as DayKey], [slot]: meal };
  }
  return map;
}

/**
 * Every published month's menu for the tenant's hostel, each with its own
 * full weekly grid — the owner publishes one schedule per month, and it's
 * a repeating weekly pattern (Mon–Sun), not calendar-dated, so there's no
 * per-date data to show. Real data via `GET /food/tenant/schedule/history`
 * (the list of published months) fanned out into one `GET /food/tenant/
 * schedule?month=` per month (parallel, cached individually) — no backend
 * change needed since that endpoint already accepts any published month.
 */
export function useTenantFoodSchedule() {
  const session = useTenantSession();

  const historyQuery = useQuery({
    queryKey: ['tenant', 'food', 'schedule-history'],
    queryFn: () => foodService.getTenantScheduleHistory(),
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const sortedMeta = useMemo(
    () => [...(historyQuery.data ?? [])].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime()),
    [historyQuery.data],
  );
  const currentMonthKey = sortedMeta[sortedMeta.length - 1]?.month;

  const scheduleQueries = useQueries({
    queries: sortedMeta.map((m) => ({
      queryKey: ['tenant', 'food', 'schedule', m.month],
      queryFn: () => foodService.getTenantSchedule(m.month),
      enabled: session.isAuthenticated,
      staleTime: 60_000,
    })),
  });
  const scheduleDataKey = scheduleQueries.map((q) => q.dataUpdatedAt).join(',');

  const months: MonthSchedule[] = useMemo(
    () =>
      sortedMeta.map((m, i) => ({
        month: m.month,
        monthLabel: new Date(m.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        isCurrent: m.month === currentMonthKey,
        grid: buildGrid(scheduleQueries[i]?.data),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedMeta, currentMonthKey, scheduleDataKey],
  );

  const currentMonth = months.find((m) => m.isCurrent) ?? null;

  return {
    isLoading: historyQuery.isLoading || scheduleQueries.some((q) => q.isLoading),
    months,
    /** Current month's grid only — kept for `useTenantHome`'s "today's meals" lookup. */
    grid: currentMonth?.grid ?? EMPTY_GRID,
  };
}
