import { useMemo, useState } from 'react';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useFoodMenuItems } from '../hooks/useFoodMenuItems';
import { useFoodVoting } from '../hooks/useFoodVoting';
import { useFoodSchedule } from '../hooks/useFoodSchedule';
import { useFoodScheduleHistory } from '../hooks/useFoodScheduleHistory';
import { FoodLibraryCard } from '../components/menu/FoodLibraryCard';
import { VotingPanel } from '../components/voting/VotingPanel';
import { WeeklyScheduleGrid } from '../components/schedule/WeeklyScheduleGrid';
import { ScheduleMealPickerSheet } from '../components/schedule/ScheduleMealPickerSheet';
import { MonthHistoryList } from '../components/schedule/MonthHistoryList';
import { TodayCard } from '../components/today/TodayCard';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { dayKeyFor, cellAt } from '../weekGrid';

/** Food tab. Thin orchestrator: each section's real work lives in its own hooks/components. */
export function FoodPage() {
  const session = useOwnerSession();
  const [selectedHostelId, setSelectedHostelId] = useState<string | null>(null);
  const hostelId = selectedHostelId ?? session.primaryHostelId;

  const library = useFoodMenuItems(hostelId);
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const currentMonthLabel = useMemo(
    () => new Date(`${currentMonth}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    [currentMonth],
  );
  const voting = useFoodVoting(hostelId, currentMonth);
  const schedule = useFoodSchedule(hostelId, currentMonth);
  const history = useFoodScheduleHistory(hostelId);

  const canGenerate = !voting.period || voting.period.status === 'CLOSED';

  const fixToday = (slot: MealSlotKey) => {
    const cell = cellAt(schedule.weekGrid, dayKeyFor(new Date()), slot);
    if (cell?.id) schedule.openPicker({ mealId: cell.id, slot });
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Meal Planner</h1>
          <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">What you're serving, and what's next</p>
        </div>
        <HostelSwitcher hostels={session.hostels} selectedId={hostelId} onSelect={setSelectedHostelId} />
      </div>

      <div className="flex flex-col gap-6.5">
        <TodayCard grid={schedule.weekGrid} onFix={fixToday} />

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

        <VotingPanel voting={voting} monthLabel={currentMonthLabel} />
        <WeeklyScheduleGrid
          schedule={schedule}
          canGenerate={canGenerate}
          voterCount={voting.results?.totalVotes ?? 0}
          votesConsidered={Boolean(voting.period)}
          tenantCount={null}
        />
        <MonthHistoryList history={history} />
      </div>

      <ScheduleMealPickerSheet
        target={schedule.pickerTarget}
        library={library.library}
        onPick={schedule.pickItem}
        onAddItem={library.createAndReturn}
        onClose={schedule.closePicker}
        isSaving={schedule.isUpdatingMeal}
      />
    </div>
  );
}
