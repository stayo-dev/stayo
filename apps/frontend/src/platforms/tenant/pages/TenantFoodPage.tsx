import { Check } from 'lucide-react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { useTenantFoodSchedule, DAY_ORDER, type DayKey } from '@features/food/hooks/useTenantFoodSchedule';
import { useTenantFoodPolls } from '@features/food/hooks/useTenantFoodPolls';
import { mealIcon } from '@features/owner-food/mealIcons';

const SLOT_ORDER: MealSlotKey[] = ['breakfast', 'lunch', 'snacks', 'dinner'];
const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};

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
 * Tenant Food tab, mounted at `/tenant/food` inside `TenantAppShell`. Real
 * data via `useTenantFoodSchedule()` (this week's published menu + history).
 */
export function TenantFoodPage() {
  const schedule = useTenantFoodSchedule();
  const polls = useTenantFoodPolls();

  if (schedule.isLoading) return <FoodLoadingSkeleton />;

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Food</h1>
        <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">This week's menu, and what you'd like to eat</p>
      </div>

      {schedule.months.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-border bg-card px-6 py-8 text-center shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <span className="flex h-[54px] w-[54px] items-center justify-center rounded-[16px] bg-secondary text-[24px]">🍽️</span>
          <span className="font-display text-[14px] font-bold text-foreground">No menu published yet</span>
          <p className="max-w-[230px] text-[12px] leading-relaxed text-muted-foreground">Your hostel owner hasn't published a menu yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {schedule.months.map((m) => (
            <div key={m.month} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-[14.5px] font-bold text-foreground">{m.monthLabel}</h2>
                {m.isCurrent && (
                  <span className="rounded-full bg-primary/10 px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-wide text-primary">Current</span>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {DAY_ORDER.map((day) => (
                  <div key={day} className="w-[126px] flex-none rounded-[16px] border border-border bg-card p-3">
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{DAY_LABEL[day]}</span>
                    <div className="flex flex-col gap-1.5">
                      {SLOT_ORDER.map((slot) => {
                        const cell = m.grid[day][slot];
                        return (
                          <div key={slot} className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{(() => { const I = mealIcon(slot); return <I className="mr-1 inline h-3 w-3 align-[-1px]" strokeWidth={1.75} />; })()}{MEAL_CATEGORY_META[slot].label}</span>
                            <span className={`truncate text-[11.5px] font-semibold ${cell?.item_name ? 'text-foreground' : 'text-muted-foreground/60 italic'}`}>{cell?.item_name ?? 'Not set'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {polls.polls.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="mt-2 border-t border-border pt-3.5">
            <h2 className="font-display text-[15px] font-bold text-foreground">Food polls</h2>
          </div>
          {polls.polls.map((poll) => (
            <div key={poll.id} className="rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="mb-2.5 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-secondary">{(() => { const I = mealIcon(poll.meal_type.toLowerCase()); return <I className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />; })()}</span>
                <span className="font-display text-sm font-bold text-foreground">{poll.title}</span>
              </div>
              <div className="flex flex-col gap-2">
                {poll.options.map((option) => {
                  const selected = poll.myOptionIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={polls.isVoting}
                      onClick={() => polls.toggleVote(poll.id, option.id)}
                      className={`flex items-center justify-between rounded-xl border p-3 text-left disabled:opacity-60 ${selected ? 'border-primary bg-secondary/40' : 'border-border bg-card'}`}
                    >
                      <span className="text-[13px] font-semibold text-foreground">{option.label}</span>
                      <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border-2 ${selected ? 'border-primary bg-primary' : 'border-border'}`}>
                        {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {poll.allow_multiple && (
                <p className="mt-2.5 text-[11px] text-muted-foreground">Pick as many as you like — tap again to unselect.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
