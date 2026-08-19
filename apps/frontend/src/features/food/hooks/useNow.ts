import { useEffect, useState } from 'react';

/**
 * A `Date` that ticks on an interval, forcing a re-render — the clock behind
 * every live meal-status/countdown display. Deliberately not tied to data
 * fetching: the underlying `meal_timings`/schedule queries stay owned by
 * React Query with their own long `staleTime` (config rarely changes), so
 * this hook never triggers a network call — it only makes "Starts in 42 min"
 * become "Starts in 41 min" without a page refresh.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
