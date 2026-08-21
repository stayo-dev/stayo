import { useState } from 'react';
import { TenantPageHeader } from '../components/TenantPageHeader';
import { ChevronLeft, Camera, TriangleAlert, Check, UtensilsCrossed } from 'lucide-react';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { useTenantFoodSchedule, DAY_ORDER, type DayKey } from '@features/food/hooks/useTenantFoodSchedule';
import { useTenantFoodPolls } from '@features/food/hooks/useTenantFoodPolls';
import { useTenantFoodVoting } from '@features/food/hooks/useTenantFoodVoting';
import { useTenantMealTimings } from '@features/food/hooks/useTenantMealTimings';
import { useNow } from '@features/food/hooks/useNow';
import { formatTimeRange, mealStatusAt, nextServingAt } from '@features/food/mealTimings';
import { NextServingCard } from '@features/food/components/NextServingCard';
import { mealIcon } from '@features/owner-food/mealIcons';
import { SLOT_ORDER } from '@features/owner-food/weekGrid';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold uppercase tracking-wide text-muted-foreground';

const STATUS_PILL: Record<'COMPLETED' | 'SERVING_NOW' | 'UPCOMING', { label: string; className: string }> = {
  COMPLETED: { label: 'Served', className: 'bg-muted text-muted-foreground' },
  SERVING_NOW: { label: 'Serving now', className: 'bg-success/15 text-success' },
  UPCOMING: { label: 'Upcoming', className: 'bg-warning-bg text-warning' },
};

const DAY_LABEL: Record<DayKey, string> = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun' };

function todayKey(): DayKey {
  const jsDay = new Date().getDay();
  return DAY_ORDER[(jsDay + 6) % 7];
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

/** Tenant Food ("My Menu") tab, per Stayo Tenant.dc.html. Real data via `useTenantFoodSchedule()` (published weekly menu), `useTenantFoodVoting()` (monthly voting period — powers "vote for next month's lunch"), `useTenantFoodPolls()` (ad-hoc polls with live tallies — powers the purple "research poll" card). */
export function TenantFoodPage() {
  const schedule = useTenantFoodSchedule();
  const polls = useTenantFoodPolls();
  const voting = useTenantFoodVoting();
  const mealTimings = useTenantMealTimings();
  const now = useNow();
  const [openMeal, setOpenMeal] = useState<{ name: string; slot: MealSlotKey } | null>(null);

  if (schedule.isLoading) return <FoodLoadingSkeleton />;

  const currentMonth = schedule.months.find((m) => m.isCurrent) ?? null;
  const today = todayKey();
  const todayMeals = currentMonth
    ? SLOT_ORDER.filter((slot) => mealTimings.mealTimings[slot]?.enabled)
        .map((slot) => ({ slot, cell: currentMonth.grid[today]?.[slot] }))
        .filter((m) => m.cell)
    : [];

  const upcoming = nextServingAt(mealTimings.mealTimings, now);
  const nextServing = upcoming
    ? { ...upcoming, itemName: currentMonth?.grid[today]?.[upcoming.slot]?.item_name ?? null }
    : null;

  const researchPoll = polls.polls[0] ?? null;
  const lunchVoteItems = voting.itemsBySlot.lunch ?? [];
  const lunchVoted = voting.myVotesBySlot.lunch?.size > 0;

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

        <NextServingCard next={nextServing} now={now} />

        {todayMeals.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>Today's meals</span>
            <div className={`${card} px-2 py-1.5`}>
              {todayMeals.map(({ slot, cell }, i) => {
                const Icon = mealIcon(slot);
                const entry = mealTimings.mealTimings[slot];
                const status = mealStatusAt(entry, now);
                const pill = STATUS_PILL[status];
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setOpenMeal({ name: cell!.item_name, slot })}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left ${i > 0 ? 'border-t border-border' : ''} ${status === 'SERVING_NOW' ? 'bg-secondary/40' : ''}`}
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-secondary text-primary">
                      <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[10px] font-semibold uppercase tracking-wide ${status === 'SERVING_NOW' ? 'text-success' : 'text-[#A2978B]'}`}>
                        {MEAL_CATEGORY_META[slot].label} · {formatTimeRange(entry)}
                      </div>
                      <div className="mt-0.5 font-display text-[15.5px] font-bold tracking-[-0.01em] text-foreground">{cell!.item_name}</div>
                    </div>
                    <span className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-bold ${pill.className}`}>{pill.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {lunchVoteItems.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>Vote for next month's lunch</span>
            <div className={`${card} p-[18px]`}>
              {!lunchVoted ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-[10px] font-bold text-warning">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" /> Voting open
                    </span>
                  </div>
                  <p className="mt-2.5 text-[12px] font-medium text-muted-foreground">Pick the lunch options you'd like to see more of.</p>
                  <div className="mt-3.5 flex flex-col gap-2">
                    {lunchVoteItems.map((item) => {
                      const active = voting.myVotesBySlot.lunch?.has(item.id) ?? false;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={voting.isVoting}
                          onClick={() => voting.toggleVote('lunch', item.id)}
                          className={`flex items-center gap-3 rounded-[14px] p-[13px_14px] text-left disabled:opacity-60 ${active ? 'border-[1.5px] border-primary bg-secondary/40' : 'border border-[#EAE1D8] bg-card'}`}
                        >
                          <span className="flex-1 font-display text-[14px] font-bold text-foreground">{item.name}</span>
                          <span className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full ${active ? 'bg-[#A45D44]' : 'border-2 border-[#DCD1C4]'}`}>
                            {active && <span className="h-[10px] w-[10px] rounded-full bg-white" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] bg-success-bg text-success">
                    <Check className="h-6 w-6" strokeWidth={2.4} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-extrabold text-foreground">Your votes are in</div>
                    <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">Thanks — this shapes next month's menu.</div>
                  </div>
                </div>
              )}
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
            <div className={`${card} px-3.5 py-1`}>
              {DAY_ORDER.map((day, i) => {
                const lunch = currentMonth.grid[day]?.lunch?.item_name;
                const dinner = currentMonth.grid[day]?.dinner?.item_name;
                const isToday = day === today;
                return (
                  <div key={day} className={`flex items-center gap-3 py-[11px] ${i > 0 ? 'border-t border-border' : ''}`}>
                    <span className={`flex h-[42px] w-[42px] flex-none flex-col items-center justify-center rounded-[11px] ${isToday ? 'bg-foreground' : 'border border-border bg-secondary/40'}`}>
                      <span className={`text-[8.5px] font-bold uppercase tracking-wide ${isToday ? 'text-[#C9BFB4]' : 'text-[#A2978B]'}`}>{DAY_LABEL[day]}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[13.5px] font-bold tracking-[-0.01em] text-foreground">{lunch ?? 'Not set'}</div>
                      <div className="mt-0.5 truncate text-[11.5px] font-medium text-muted-foreground">Dinner · {dinner ?? 'Not set'}</div>
                    </div>
                    {isToday && <span className="flex-none rounded-full bg-success-bg px-2.5 py-1 text-[9.5px] font-bold text-success">Today</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!currentMonth && lunchVoteItems.length === 0 && !researchPoll && (
          <div className={card}>
            <EmptyState
              icon={<UtensilsCrossed className="h-5 w-5" />}
              title="No menu published yet"
              description="Your hostel owner hasn't published a food menu yet — check back once they do."
            />
          </div>
        )}

        {researchPoll && (
          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>Help improve the menu</span>
            <div className="rounded-[16px] border border-research-border bg-research-bg p-[15px_16px]">
              <div className="font-display text-[13.5px] font-bold tracking-[-0.01em] text-foreground">{researchPoll.title}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {researchPoll.options.map((option) => {
                  const selected = researchPoll.myOptionIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={polls.isVoting}
                      onClick={() => polls.toggleVote(researchPoll.id, option.id)}
                      className={`rounded-[11px] px-[13px] py-[9px] text-[12px] font-semibold disabled:opacity-60 ${selected ? 'bg-research text-research-foreground' : 'border border-research-border bg-card text-[#6E6459]'}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] font-medium text-[#8A6FBF]">
                {researchPoll.options.reduce((n, o) => n + o.votes, 0)} votes so far · closes {new Date(researchPoll.closes_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </p>
            </div>
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
