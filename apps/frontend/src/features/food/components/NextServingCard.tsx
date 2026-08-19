import { CheckCircle2, MoonStar } from 'lucide-react';
import { FOOD_SLOTS, MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { mealIcon } from '@features/owner-food/mealIcons';
import { formatCountdown, formatTimeRange, type MealStatus, type MealTimingEntry } from '../mealTimings';

export interface NextServing {
  slot: MealSlotKey;
  entry: MealTimingEntry;
  itemName: string | null;
  status: MealStatus;
}

interface NextServingCardProps {
  next: NextServing | null;
  now: Date;
}

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/**
 * The tenant Food/Home hero — "what's serving, and when." No `.dc.html`
 * mockup covers this (verified) — built from the same card/pill/tint
 * vocabulary the rest of the tenant app already uses, not a new visual
 * system. Mounted on both `TenantFoodPage` and `TenantHomePage`, sharing
 * `useTenantMealTimings()`'s cached data and a local `useNow()` tick — see
 * the Meal Timings ADR.
 */
export function NextServingCard({ next, now }: NextServingCardProps) {
  if (!next) {
    return (
      <div className={`${card} flex items-center gap-3 p-4`}>
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-secondary text-primary">
          <MoonStar className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14px] font-bold text-foreground">That's all for today</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">Check back tomorrow for the next meal.</div>
        </div>
      </div>
    );
  }

  const Icon = mealIcon(next.slot);
  const tint = FOOD_SLOTS.find((s) => s.key === next.slot)?.tint ?? '#F5EFE8';
  const color = FOOD_SLOTS.find((s) => s.key === next.slot)?.color ?? '#B46A55';
  const isServingNow = next.status === 'SERVING_NOW';

  return (
    <div className={`${card} p-4`}>
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Next Serving</span>
      <div className="mt-2 flex items-center gap-3.5">
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[13px]" style={{ background: tint }}>
          <Icon className="h-5 w-5" style={{ color }} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-foreground">{MEAL_CATEGORY_META[next.slot].label}</div>
          <div className="mt-0.5 truncate text-[13px] font-semibold text-foreground/80">{next.itemName ?? 'Not set'}</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">{formatTimeRange(next.entry)}</div>
        </div>
        <span
          className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-bold ${isServingNow ? 'bg-success/15 text-success' : 'bg-warning-bg text-warning'}`}
        >
          {isServingNow ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2.6} /> Serving Now
            </span>
          ) : (
            formatCountdown(next.entry, now)
          )}
        </span>
      </div>
    </div>
  );
}
