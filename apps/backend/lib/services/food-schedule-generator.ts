import { FoodDayOfWeek } from "@prisma/client";

export interface RankedFoodItem {
  id: string;
  name: string;
  votes: number;
}

export interface DayAssignment {
  day_of_week: FoodDayOfWeek;
  menu_item_id: string | null;
  item_name: string;
}

const DAYS: FoodDayOfWeek[] = [
  FoodDayOfWeek.MONDAY,
  FoodDayOfWeek.TUESDAY,
  FoodDayOfWeek.WEDNESDAY,
  FoodDayOfWeek.THURSDAY,
  FoodDayOfWeek.FRIDAY,
  FoodDayOfWeek.SATURDAY,
  FoodDayOfWeek.SUNDAY,
];

/**
 * Assigns one item to each of the 7 weekdays for a single meal type.
 *
 * v1 heuristic, not claimed-optimal: each ranked item gets a share of the 7
 * slots proportional to its vote count (largest-remainder rounding so the
 * shares sum to exactly 7; even split if nobody voted), then slots are
 * filled via a round-robin "deal" pass over the ranked list — each pass
 * places at most one occurrence of each item before moving to the next,
 * which naturally spreads repeats across the week instead of clustering the
 * same item on consecutive days.
 */
export function assignWeekForMealType(ranked: RankedFoodItem[]): DayAssignment[] {
  if (ranked.length === 0) {
    return DAYS.map((day) => ({ day_of_week: day, menu_item_id: null, item_name: "Not set" }));
  }

  const totalVotes = ranked.reduce((sum, r) => sum + r.votes, 0);
  let counts: number[];

  if (totalVotes === 0) {
    counts = ranked.map((_, i) => Math.floor(7 / ranked.length) + (i < 7 % ranked.length ? 1 : 0));
  } else {
    const raw = ranked.map((r) => (r.votes / totalVotes) * 7);
    counts = raw.map((n) => Math.floor(n));
    let remainder = 7 - counts.reduce((a, b) => a + b, 0);
    const byFraction = raw
      .map((n, i) => ({ i, frac: n - Math.floor(n) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < remainder; k++) {
      counts[byFraction[k % byFraction.length].i] += 1;
    }
  }

  const slots: RankedFoodItem[] = [];
  const remaining = [...counts];
  while (slots.length < 7) {
    let placedThisPass = false;
    for (let i = 0; i < ranked.length && slots.length < 7; i++) {
      if (remaining[i] > 0) {
        slots.push(ranked[i]);
        remaining[i] -= 1;
        placedThisPass = true;
      }
    }
    if (!placedThisPass) break; // safety net — counts should always sum to 7
  }
  while (slots.length < 7) slots.push(ranked[slots.length % ranked.length]);

  return DAYS.map((day, idx) => ({ day_of_week: day, menu_item_id: slots[idx].id, item_name: slots[idx].name }));
}
