import { useState } from 'react';
import { TenantPageHeader } from '../components/TenantPageHeader';
import { ChevronDown, ChevronLeft, Camera, TriangleAlert, UtensilsCrossed } from 'lucide-react';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { useTenantFoodSchedule, DAY_ORDER, type DayKey } from '@features/food/hooks/useTenantFoodSchedule';
import { useTenantFoodPolls } from '@features/food/hooks/useTenantFoodPolls';
import { useTenantMealTimings } from '@features/food/hooks/useTenantMealTimings';
import { useNow } from '@features/food/hooks/useNow';
import { formatTimeRange, mealStatusAt } from '@features/food/mealTimings';
import { ActivePollCard } from '@features/food/components/ActivePollCard';
import { mealIcon } from '@features/owner-food/mealIcons';
import { formatCellItems, SLOT_ORDER, type WeekGridItem } from '@features/owner-food/weekGrid';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold uppercase tracking-wide text-muted-foreground';

const STATUS_PILL: Record<'COMPLETED' | 'SERVING_NOW' | 'UPCOMING', { label: string; className: string }> = {
  COMPLETED: { label: 'Served', className: 'bg-muted text-muted-foreground' },
  SERVING_NOW: { label: 'Serving now', className: 'bg-success/15 text-success' },
  UPCOMING: { label: 'Upcoming', className: 'bg-warning-bg text-warning' },
};

const DAY_LABEL: Record<DayKey, string> = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun' };
const DAY_LABEL_FULL: Record<DayKey, string> = { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday' };

function todayKey(): DayKey {
  const jsDay = new Date().getDay();
  return DAY_ORDER[(jsDay + 6) % 7];
}

/** `formatCellItems` for a tenant-schedule cell (which carries `food_schedule_meal_items` on the wire, not `items`). */
function cellItems(cell: { food_schedule_meal_items: WeekGridItem[] } | null | undefined): string {
  return formatCellItems(cell ? { items: cell.food_schedule_meal_items } : null);
}

function FoodLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/**
 * Tenant Food ("My Menu") tab, per Stayo Tenant.dc.html. Real data via
 * `useTenantFoodSchedule()` (published weekly menu) and `useTenantFoodPolls()`
 * (the one real, owner-editable food poll — same hook/query the tenant
 * Home tab uses for its own `ActivePollCard`, so both surfaces always agree).
 * "Today's Menu" always shows today's Breakfast/Lunch/Snacks/Dinner with a
 * live Served/Serving now/Upcoming pill on each. Below it, "My weekly menu"
 * is a day accordion — every row starts collapsed to just its name, tapping
 * a day expands/collapses it to show its own full meal list (no live status
 * pill unless that day happens to be today).
 */
export function TenantFoodPage() {
  const schedule = useTenantFoodSchedule();
  const polls = useTenantFoodPolls();
  const mealTimings = useTenantMealTimings();
  const now = useNow();
  const [openMeal, setOpenMeal] = useState<{ name: string; slot: MealSlotKey } | null>(null);
  const [expandedDay, setExpandedDay] = useState<DayKey | null>(null);

  if (schedule.isLoading) return <FoodLoadingSkeleton />;

  const currentMonth = schedule.months.find((m) => m.isCurrent) ?? null;
  const today = todayKey();

  function mealsForDay(day: DayKey) {
    return SLOT_ORDER.filter((slot) => mealTimings.mealTimings[slot]?.enabled)
      .map((slot) => ({ slot, cell: currentMonth?.grid[day]?.[slot] }))
      .filter((m) => m.cell);
  }

  const activePoll = polls.polls[0] ?? null;

  return (
    <div className="min-h-screen">
      <TenantPageHeader
        title="My Menu"
        subtitle="Your meals this week"
        right={
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#B0A597]">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long' })}
            </div>
            <div className="font-display text-[13px] font-bold text-foreground">
              {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </div>
          </div>
        }
      />
      <div className="flex flex-col gap-6 px-5 pb-8 pt-5">

        {mealsForDay(today).length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>Today's Menu</span>
            <div className={`${card} px-2 py-1.5`}>
              {mealsForDay(today).map(({ slot, cell }, i) => {
                const Icon = mealIcon(slot);
                const entry = mealTimings.mealTimings[slot];
                const status = mealStatusAt(entry, now);
                const pill = STATUS_PILL[status];
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setOpenMeal({ name: cellItems(cell), slot })}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left ${i > 0 ? 'border-t border-border' : ''} ${status === 'SERVING_NOW' ? 'bg-secondary/40' : ''}`}
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-secondary text-primary">
                      <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[10px] font-semibold uppercase tracking-wide ${status === 'SERVING_NOW' ? 'text-success' : 'text-[#A2978B]'}`}>
                        {MEAL_CATEGORY_META[slot].label} · {formatTimeRange(entry)}
                      </div>
                      <div className="mt-0.5 font-display text-[15.5px] font-bold tracking-[-0.01em] text-foreground">{cellItems(cell)}</div>
                    </div>
                    <span className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-bold ${pill.className}`}>{pill.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {currentMonth && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <span className={sectionLabel}>My weekly menu</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-info">
                <span className="h-1.5 w-1.5 rounded-full bg-info" /> {currentMonth.monthLabel}
              </span>
            </div>
            <p className="-mt-1.5 text-[11.5px] font-medium text-muted-foreground">Tap a day to see all meals</p>
            <div className={`${card} px-3.5 py-1`}>
              {DAY_ORDER.map((day, i) => {
                const isToday = day === today;
                const isExpanded = day === expandedDay;
                return (
                  <div key={day} className={i > 0 ? 'border-t border-border' : ''}>
                    <button
                      type="button"
                      onClick={() => setExpandedDay((d) => (d === day ? null : day))}
                      className="flex w-full items-center gap-3 py-[11px] text-left"
                    >
                      <span className={`flex h-[42px] w-[42px] flex-none flex-col items-center justify-center rounded-[11px] ${isToday ? 'bg-foreground' : 'border border-border bg-secondary/40'}`}>
                        <span className={`text-[8.5px] font-bold uppercase tracking-wide ${isToday ? 'text-[#C9BFB4]' : 'text-[#A2978B]'}`}>{DAY_LABEL[day]}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-[14px] font-bold tracking-[-0.01em] text-foreground">{DAY_LABEL_FULL[day]}</div>
                      </div>
                      {isToday && <span className="flex-none rounded-full bg-success-bg px-2.5 py-1 text-[9.5px] font-bold text-success">Today</span>}
                      <ChevronDown className={`h-4 w-4 flex-none text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {isExpanded && (
                      <div className="flex flex-col gap-1.5 pb-3">
                        {mealsForDay(day).map(({ slot, cell }) => {
                          const Icon = mealIcon(slot);
                          const entry = mealTimings.mealTimings[slot];
                          const status = isToday ? mealStatusAt(entry, now) : null;
                          const pill = status ? STATUS_PILL[status] : null;
                          return (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => setOpenMeal({ name: cellItems(cell), slot })}
                              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left ${status === 'SERVING_NOW' ? 'bg-secondary/40' : ''}`}
                            >
                              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
                                <Icon className="h-4 w-4" strokeWidth={1.75} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className={`text-[10px] font-semibold uppercase tracking-wide ${status === 'SERVING_NOW' ? 'text-success' : 'text-[#A2978B]'}`}>
                                  {MEAL_CATEGORY_META[slot].label} · {formatTimeRange(entry)}
                                </div>
                                <div className="mt-0.5 font-display text-[14.5px] font-bold tracking-[-0.01em] text-foreground">{cellItems(cell)}</div>
                              </div>
                              {pill && <span className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-bold ${pill.className}`}>{pill.label}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activePoll && (
          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>Active food poll</span>
            <ActivePollCard poll={activePoll} onToggleVote={(optionId) => polls.toggleVote(activePoll.id, optionId)} isVoting={polls.isVoting} />
          </div>
        )}

        {!currentMonth && !activePoll && (
          <div className={card}>
            <EmptyState
              icon={<UtensilsCrossed className="h-5 w-5" />}
              title="No menu published yet"
              description="Your hostel owner hasn't published a food menu yet — check back once they do."
            />
          </div>
        )}

        <p className="pt-0.5 text-center text-[11px] font-medium text-[#B7AC9F]">Stayo</p>
      </div>

      {openMeal && (
        <div className="stayo-panel-slide-in fixed inset-0 z-[45] flex flex-col bg-background">
          <div className="flex flex-none items-center gap-3 px-[18px] pb-3 pt-14">
            <button type="button" onClick={() => setOpenMeal(null)} className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border border-border bg-card">
              <ChevronLeft className="h-[18px] w-[18px] text-[#4A433C]" strokeWidth={2} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-foreground">{openMeal.name}</div>
              <div className="text-[11.5px] font-medium text-muted-foreground">{MEAL_CATEGORY_META[openMeal.slot].label}</div>
            </div>
          </div>
          <div className="flex-1 overflow-auto px-[18px] pb-7 pt-2">
            <div className="flex h-[150px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-[#F3EAD8] text-[#B0A597]">
              <Camera className="h-[30px] w-[30px]" strokeWidth={1.5} />
              <span className="text-[11px] font-semibold">Meal photo</span>
            </div>
            <div className="mt-5 flex items-center gap-2.5 rounded-2xl border border-[#F1E2C4] bg-warning-bg p-[13px_15px]">
              <TriangleAlert className="h-[18px] w-[18px] flex-none text-warning" strokeWidth={1.9} />
              <p className="flex-1 text-[12px] font-semibold text-[#7A5A24]">Full details will be added by your hostel.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
