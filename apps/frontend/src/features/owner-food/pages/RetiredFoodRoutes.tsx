import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * `/owner/food/meal-timings` and `/owner/food/timetable` were merged into one
 * `/owner/food/meal-plan` page (ADR-121) — Meal Timings and the Weekly
 * Timetable are sections of that page now, not separate routes. Forwards the
 * full querystring so old links/bookmarks still work: `?hostelId=` (both
 * routes carried it) and `?day=&slot=` (the Today card's "Fix" deep link,
 * which the old Timetable page read once on mount — `MealPlanPage` does the
 * same).
 */
export function RetiredToMealPlan() {
  const [searchParams] = useSearchParams();
  return <Navigate to={`/owner/food/meal-plan?${searchParams.toString()}`} replace />;
}
