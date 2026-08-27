import { useMemo, useState } from 'react';
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
import type { PollRow } from '../polls/pollTypes';

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

/** Groups polls by the month of `poll_date`, most recent month first, dates ascending within a month — a calendar-style read of the list rather than an Active/Closed split. */
function groupByMonth(polls: PollRow[]): { key: string; label: string; polls: PollRow[] }[] {
  const groups = new Map<string, PollRow[]>();
  for (const poll of polls) {
    const key = monthKey(poll.poll_date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(poll);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, groupPolls]) => ({
      key,
      label: new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      polls: [...groupPolls].sort((a, b) => new Date(a.poll_date).getTime() - new Date(b.poll_date).getTime()),
    }));
}

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
  const [editingPoll, setEditingPoll] = useState<PollRow | null>(null);
  const polls = useFoodPolls(hostelId);
  const library = useFoodMenuItems(hostelId);
  const monthGroups = useMemo(() => groupByMonth(polls.polls), [polls.polls]);

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

      <div className="flex items-center justify-end gap-2">
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
          <span className="font-display text-[15px] font-bold text-foreground">No polls yet</span>
          <p className="max-w-[250px] text-[12.5px] leading-relaxed text-muted-foreground">Ask tenants what they want for a specific meal.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {monthGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{group.label}</span>
              <div className="flex flex-col gap-3">
                {group.polls.map((poll) => (
                  <PollCard
                    key={poll.id}
                    poll={poll}
                    onViewResults={() => polls.openResults(poll.id)}
                    onClose={() => polls.closePoll(poll.id)}
                    onEdit={() => setEditingPoll(poll)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreatePollModal
        open={createOpen || Boolean(editingPoll)}
        onClose={() => {
          setCreateOpen(false);
          setEditingPoll(null);
        }}
        onPublish={(poll) => polls.publishPoll(poll)}
        editingPoll={editingPoll}
        onSave={(pollId, patch) => polls.updatePoll(pollId, patch)}
      />

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
