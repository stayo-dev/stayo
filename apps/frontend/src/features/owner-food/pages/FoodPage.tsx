import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { FOOD_SLOTS } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useFoodMenuItems } from '../hooks/useFoodMenuItems';
import { useFoodVoting } from '../hooks/useFoodVoting';
import { useFoodSchedule } from '../hooks/useFoodSchedule';
import { useFoodScheduleHistory } from '../hooks/useFoodScheduleHistory';
import { useFoodPolls } from '../hooks/useFoodPolls';
import type { FoodView } from '../types';
import { FoodLibraryCard } from '../components/menu/FoodLibraryCard';
import { VotingPanel } from '../components/voting/VotingPanel';
import { WeeklyScheduleGrid } from '../components/schedule/WeeklyScheduleGrid';
import { ScheduleMealPickerSheet } from '../components/schedule/ScheduleMealPickerSheet';
import { MonthHistoryList } from '../components/schedule/MonthHistoryList';
import { PollSegmentedControl } from '../components/polls/PollSegmentedControl';
import { PollCard } from '../components/polls/PollCard';
import { SmartInsightsList } from '../components/polls/SmartInsightsList';
import { CreatePollModal } from '../create-poll/CreatePollModal';
import { PollResultsSheet } from '../poll-results/PollResultsSheet';

const POLL_EMPTY_TEXT: Record<'active' | 'scheduled' | 'closed', string> = {
  active: 'No live polls. Create one to hear from your tenants.',
  scheduled: 'No scheduled polls yet.',
  closed: 'No closed polls in your history yet.',
};

/** Food tab — Monthly Schedule / Food Polls, per Stayo App.dc.html. Thin orchestrator: each sub-view's real work lives in its own hooks/components. */
export function FoodPage() {
  const location = useLocation();
  const [view, setView] = useState<FoodView>('menu');
  const [createPollOpen, setCreatePollOpen] = useState(false);

  const session = useOwnerSession();
  const library = useFoodMenuItems(session.primaryHostelId);
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const currentMonthLabel = useMemo(() => new Date(`${currentMonth}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), [currentMonth]);
  const voting = useFoodVoting(session.primaryHostelId, currentMonth);
  const schedule = useFoodSchedule(session.primaryHostelId, currentMonth);
  const history = useFoodScheduleHistory(session.primaryHostelId);
  const polls = useFoodPolls();

  // Home's Quick Actions -> "Create Food Poll" navigates here with router
  // state instead of duplicating the sheet's flow — open it once on arrival.
  useEffect(() => {
    if ((location.state as { openCreatePoll?: boolean } | null)?.openCreatePoll) {
      setView('polls');
      setCreatePollOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resultsPoll = polls.polls.find((p) => p.id === polls.resultsPollId) ?? null;
  const filteredPolls = polls.polls.filter((p) => p.status === polls.pollTab);
  // Generation needs *some* signal to rank against — either a closed voting
  // period (real votes) or, if none exists yet, the library itself (falls
  // back to an even split, per the generator's own zero-vote handling).
  const canGenerate = !voting.period || voting.period.status === 'CLOSED';

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">{view === 'polls' ? 'Food Polls' : 'Meal Planner'}</h1>
          <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
            {view === 'polls' ? "Ask tenants what they'd like to eat" : "Create and manage your hostel's monthly menu"}
          </p>
        </div>
        {view === 'polls' && (
          <button
            type="button"
            onClick={() => setCreatePollOpen(true)}
            className="flex flex-none items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 font-display text-[12.5px] font-bold text-primary-foreground shadow-[0_6px_16px_rgba(180,106,85,0.3)]"
          >
            <Plus className="h-3.5 w-3.5" /> Create Poll
          </button>
        )}
      </div>

      <div className="flex gap-1 rounded-[13px] bg-[#F0EAE2] p-1">
        <button
          type="button"
          onClick={() => setView('menu')}
          className={`flex-1 rounded-[10px] py-2.5 text-center font-display text-[12.5px] font-bold ${view === 'menu' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
        >
          Monthly Schedule
        </button>
        <button
          type="button"
          onClick={() => setView('polls')}
          className={`flex-1 rounded-[10px] py-2.5 text-center font-display text-[12.5px] font-bold ${view === 'polls' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
        >
          Food Polls
        </button>
      </div>

      {view === 'menu' && (
        <div className="flex flex-col gap-6.5">
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

          <WeeklyScheduleGrid schedule={schedule} canGenerate={canGenerate} />

          <MonthHistoryList history={history} />
        </div>
      )}

      {view === 'polls' && (
        <div className="flex flex-col gap-5">
          <PollSegmentedControl polls={polls.polls} pollTab={polls.pollTab} onChange={polls.setPollTab} />

          {filteredPolls.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-[20px] border border-border bg-card px-6 py-9 text-center shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <span className="flex h-[62px] w-[62px] items-center justify-center rounded-[18px] bg-[#F6ECE6] text-primary">
                <Sparkles className="h-7 w-7" />
              </span>
              <span className="font-display text-[15px] font-bold text-foreground">Nothing here yet</span>
              <p className="max-w-[230px] text-[12.5px] leading-relaxed text-muted-foreground">{POLL_EMPTY_TEXT[polls.pollTab]}</p>
              <button type="button" onClick={() => setCreatePollOpen(true)} className="mt-1 rounded-xl bg-primary px-5 py-2.5 font-display text-[13px] font-bold text-primary-foreground">
                Create a poll
              </button>
            </div>
          )}

          <div className="flex flex-col gap-3.5">
            {filteredPolls.map((p) => (
              <PollCard key={p.id} poll={p} onViewResults={() => polls.openResults(p.id)} onEdit={() => stayoToast.info('Opening poll editor…')} onClose={() => polls.closePoll(p.id)} />
            ))}
          </div>

          <SmartInsightsList />
        </div>
      )}

      <ScheduleMealPickerSheet
        target={schedule.pickerTarget}
        library={library.library}
        onPick={schedule.pickItem}
        onClose={schedule.closePicker}
        isSaving={schedule.isUpdatingMeal}
      />
      <CreatePollModal open={createPollOpen} onClose={() => setCreatePollOpen(false)} onPublish={polls.publishPoll} />
      <PollResultsSheet poll={resultsPoll} onClose={polls.closeResults} onUseWinner={() => polls.useWinner(() => setView('menu'))} />
    </div>
  );
}
