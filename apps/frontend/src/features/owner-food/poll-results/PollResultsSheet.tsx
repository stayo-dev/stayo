import { Trophy } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { getPollWinner, optionPercent, type PollOptionRow } from '../polls/pollTypes';
import { mealIcon } from '../mealIcons';

interface ResultsPoll {
  title: string;
  meal_type: string;
  poll_date: string;
}

interface PollResultsSheetProps {
  poll: ResultsPoll | null;
  options: PollOptionRow[];
  totalVotes: number;
  voterCount: number;
  eligibleCount: number;
  isLoading: boolean;
  onClose: () => void;
  onUseWinner: () => void;
  isUsingWinner: boolean;
}

/** Poll Results — stats tiles, winner banner, vote-breakdown bars, Done / Use Winning Option. A tall BottomSheet, opened from within Food Polls rather than a distinct nav destination. */
export function PollResultsSheet({ poll, options, totalVotes, voterCount, eligibleCount, isLoading, onClose, onUseWinner, isUsingWinner }: PollResultsSheetProps) {
  if (!poll) return null;
  const meta = MEAL_CATEGORY_META[poll.meal_type.toLowerCase() as MealSlotKey];
  const winner = getPollWinner(options);
  const participation = eligibleCount ? Math.round((voterCount / eligibleCount) * 100) : 0;

  return (
    <BottomSheet
      open={!!poll}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col gap-0.5">
          <span className="truncate">{poll.title}</span>
          <span className="text-[11.5px] font-normal text-muted-foreground">
            {(() => { const I = mealIcon(poll.meal_type.toLowerCase()); return <I className="mr-1 inline h-3 w-3 align-[-1px]" strokeWidth={1.75} />; })()}{meta.label} · {new Date(poll.poll_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        </span>
      }
      footer={
        <div className="flex gap-2.5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border-[1.5px] border-border py-3.5 text-center font-display text-[13.5px] font-bold text-foreground">
            Done
          </button>
          <button
            type="button"
            onClick={onUseWinner}
            disabled={!winner || isUsingWinner}
            className="flex-[1.4] rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {isUsingWinner ? 'Adding…' : 'Use Winning Option →'}
          </button>
        </div>
      }
    >
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex gap-2.5">
            <div className="flex-1 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="font-display text-xl font-extrabold tabular-nums text-foreground">{eligibleCount}</div>
              <div className="mt-0.5 text-[10.5px] text-muted-foreground">Eligible tenants</div>
            </div>
            <div className="flex-1 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="font-display text-xl font-extrabold tabular-nums text-foreground">{voterCount}</div>
              <div className="mt-0.5 text-[10.5px] text-muted-foreground">Tenants voted</div>
            </div>
            <div className="flex-1 rounded-2xl bg-foreground p-3.5">
              <div className="font-display text-xl font-extrabold tabular-nums text-background">{participation}%</div>
              <div className="mt-0.5 text-[10.5px] text-background/70">Participation</div>
            </div>
          </div>

          {winner ? (
            <div className="flex items-center gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3.5">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary">
                <Trophy className="h-5 w-5 text-primary-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Winning option</div>
                <div className="font-display text-base font-extrabold tracking-tight text-foreground">{winner.label}</div>
              </div>
              <div className="font-display text-xl font-extrabold text-primary">{optionPercent(winner, options)}%</div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card px-4 py-3.5 text-center text-[12.5px] text-muted-foreground">No votes yet.</div>
          )}

          <div className="flex flex-col gap-3.5">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vote breakdown</span>
            {options.map((o) => {
              const isWinner = winner?.id === o.id;
              const pct = optionPercent(o, options);
              return (
                <div key={o.id}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className={`text-[13px] font-semibold ${isWinner ? 'text-foreground' : 'text-foreground/80'}`}>{o.label}</span>
                    <span className={`font-display text-[13px] font-extrabold tabular-nums ${isWinner ? 'text-primary' : 'text-muted-foreground'}`}>{pct}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full transition-all ${isWinner ? 'bg-primary' : 'bg-border'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{totalVotes} total {totalVotes === 1 ? 'vote' : 'votes'} — tenants may pick more than one option on a multiple-choice poll.</p>
        </div>
      )}
    </BottomSheet>
  );
}
