import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Plus, Vote } from 'lucide-react';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { PollCard } from '../components/polls/PollCard';
import { CreatePollModal } from '../create-poll/CreatePollModal';
import { PollResultsSheet } from '../poll-results/PollResultsSheet';
import { useFoodPolls } from '../hooks/useFoodPolls';
import { useFoodMenuItems } from '../hooks/useFoodMenuItems';
import type { PollStatus } from '../polls/pollTypes';

const TABS: { key: PollStatus; label: string }[] = [
  { key: 'OPEN', label: 'Active' },
  { key: 'CLOSED', label: 'Closed' },
];

/**
 * Food Polls — ad-hoc, owner-created, independent of the dormant monthly
 * voting window (see docs/obsidian/Food.md, ADR-057). Route `/owner/food/polls`,
 * hostel carried on `?hostelId=` same as the Kitchen sheet.
 */
export function FoodPollsPage() {
  const session = useOwnerSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostelId = searchParams.get('hostelId') ?? session.primaryHostelId ?? undefined;

  const [createOpen, setCreateOpen] = useState(false);
  const polls = useFoodPolls(hostelId);
  const library = useFoodMenuItems(hostelId);

  const resultsPoll = polls.polls.find((p) => p.id === polls.resultsPollId) ?? null;
  const resultsPollMeta = resultsPoll ? { title: resultsPoll.title, meal_type: resultsPoll.meal_type, poll_date: resultsPoll.poll_date } : null;
  const [isUsingWinner, setIsUsingWinner] = useState(false);

  const handleUseWinner = async () => {
    if (!resultsPoll || !polls.results) return;
    const winner = polls.results.options.reduce((a, b) => (b.votes > a.votes ? b : a), polls.results.options[0]);
    if (!winner || winner.votes === 0) return;
    setIsUsingWinner(true);
    const slot = resultsPoll.meal_type.toLowerCase() as Parameters<typeof library.createAndReturn>[0];
    const id = await library.createAndReturn(slot, winner.label);
    setIsUsingWinner(false);
    if (id) {
      stayoToast.success(`"${winner.label}" added to your Food Library · edit before publishing the schedule`);
      polls.closeResults();
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={hostelId ? `/owner/food?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food'} className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Food Polls</h1>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">Ask what tenants want, and let it settle it</p>
          </div>
        </div>
        <HostelSwitcher hostels={session.hostels} selectedId={hostelId ?? null} onSelect={(id) => setSearchParams({ hostelId: id }, { replace: true })} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => polls.setTab(t.key)}
              className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold ${polls.tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex min-h-[36px] items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[12.5px] font-bold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Create Poll
        </button>
      </div>

      {polls.isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      ) : polls.polls.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[20px] border border-border bg-card px-6 py-10 text-center shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <span className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-secondary"><Vote className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} /></span>
          <span className="font-display text-[15px] font-bold text-foreground">
            {polls.tab === 'OPEN' ? 'No active polls' : 'No closed polls yet'}
          </span>
          <p className="max-w-[250px] text-[12.5px] leading-relaxed text-muted-foreground">
            {polls.tab === 'OPEN' ? 'Ask tenants what they want for a specific meal.' : "Polls show up here once they've closed."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {polls.polls.map((poll) => (
            <PollCard key={poll.id} poll={poll} onViewResults={() => polls.openResults(poll.id)} onClose={() => polls.closePoll(poll.id)} />
          ))}
        </div>
      )}

      <CreatePollModal open={createOpen} onClose={() => setCreateOpen(false)} onPublish={(poll) => polls.publishPoll(poll)} />

      <PollResultsSheet
        poll={resultsPollMeta}
        options={polls.results?.options ?? []}
        totalVotes={polls.results?.totalVotes ?? 0}
        voterCount={polls.results?.voterCount ?? 0}
        eligibleCount={polls.results?.eligibleCount ?? 0}
        isLoading={polls.isLoadingResults}
        onClose={polls.closeResults}
        onUseWinner={handleUseWinner}
        isUsingWinner={isUsingWinner}
      />
    </div>
  );
}
