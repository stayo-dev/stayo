import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChefHat, Clock, Vote } from 'lucide-react';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useFoodMenuItems } from '../hooks/useFoodMenuItems';
import { useFoodSchedule } from '../hooks/useFoodSchedule';
import { useFoodScheduleHistory } from '../hooks/useFoodScheduleHistory';
import { useMealTimings } from '../hooks/useMealTimings';
import { FoodLibraryCard } from '../components/menu/FoodLibraryCard';
import { MonthHistoryList } from '../components/schedule/MonthHistoryList';
import { TodayCard } from '../components/today/TodayCard';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { dayKeyFor } from '../weekGrid';

/** Food tab. Thin orchestrator: each section's real work lives in its own hooks/components. */
export function FoodPage() {
  const session = useOwnerSession();
  const navigate = useNavigate();
  const [selectedHostelId, setSelectedHostelId] = useState<string | null>(null);
  const hostelId = selectedHostelId ?? session.primaryHostelId;

  const library = useFoodMenuItems(hostelId);
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const schedule = useFoodSchedule(hostelId, currentMonth);
  const history = useFoodScheduleHistory(hostelId);
  const mealTimings = useMealTimings(hostelId);

  // The Timetable page (not a picker sheet here any more) is where editing
  // happens — "Fix" just lands the owner on today's day/slot already selected.
  const fixToday = (slot: MealSlotKey) => {
    const day = dayKeyFor(new Date());
    const params = new URLSearchParams({ day, slot, ...(hostelId ? { hostelId } : {}) });
    navigate(`/owner/food/timetable?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Meal Planner</h1>
          <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">What you're serving, and what's next</p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <Link
            to={hostelId ? `/owner/food/polls?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food/polls'}
            aria-label="Food Polls"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(180,106,85,0.32)]"
          >
            <Vote className="h-6 w-6" />
          </Link>
          <HostelSwitcher hostels={session.hostels} selectedId={hostelId} onSelect={setSelectedHostelId} />
        </div>
      </div>

      <div className="flex flex-col gap-6.5">
        <TodayCard
          grid={schedule.weekGrid}
          isLoading={schedule.isLoading}
          hasSchedule={Boolean(schedule.schedule)}
          onFix={fixToday}
          mealTimings={mealTimings.mealTimings}
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Food Library</span>
            <span className="text-[11.5px] text-muted-foreground/70">Tap to expand</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {FOOD_SLOTS.map((slotMeta) => (
              <FoodLibraryCard key={slotMeta.key} slotMeta={slotMeta} items={library.library[slotMeta.key]} library={library} />
            ))}
          </div>
        </div>

        <Link
          to={hostelId ? `/owner/food/meal-timings?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food/meal-timings'}
          className="flex min-h-[44px] items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
            <Clock className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-foreground">Meal Timings</span>
            <span className="block text-[11px] text-muted-foreground">Edit your hostel's serving hours</span>
          </span>
        </Link>

        <Link
          to={hostelId ? `/owner/food/timetable?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food/timetable'}
          className="flex min-h-[44px] items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
            <CalendarDays className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-foreground">Weekly Timetable</span>
            <span className="block text-[11px] text-muted-foreground">
              {schedule.schedule?.status === 'PUBLISHED' ? 'Published — drag food into any day' : 'Build this month by dragging food into each day'}
            </span>
          </span>
        </Link>
        <MonthHistoryList history={history} />

        {/* The hostel rides on the URL — the kitchen sheet has no switcher
            state of its own to inherit, and sending the wrong property's menu
            to a WhatsApp group is not a recoverable mistake. */}
        <Link
          to={hostelId ? `/owner/food/kitchen?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food/kitchen'}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,0.32)]"
        >
          <ChefHat className="h-4 w-4" /> Send to kitchen
        </Link>
      </div>
    </div>
  );
}
