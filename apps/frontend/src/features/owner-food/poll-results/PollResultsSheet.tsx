import { Trophy } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { MEAL_CATEGORY_META, getPollWinner, type MockFoodPoll } from '@shared/mocks/food';

interface PollResultsSheetProps {
  poll: MockFoodPoll | null;
  onClose: () => void;
  onUseWinner: () => void;
}

/** Poll Results — stats tiles, winner banner, vote-breakdown bars, Done / Use Winning Option. Built as a tall BottomSheet since it's opened from within Food, not a distinct nav destination. */
export function PollResultsSheet({ poll, onClose, onUseWinner }: PollResultsSheetProps) {
  if (!poll) return null;
  const meta = MEAL_CATEGORY_META[poll.mealCat];
  const winner = getPollWinner(poll);
  const participation = poll.totalTenants ? Math.round((poll.votes / poll.totalTenants) * 100) : 0;

  return (
    <BottomSheet
      open={!!poll}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col gap-0.5">
          <span className="truncate">{poll.title}</span>
          <span className="text-[11.5px] font-normal text-muted-foreground">
            {meta.emoji} {meta.label} · {poll.date}
          </span>
        </span>
      }
      footer={
        <div className="flex gap-2.5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border-[1.5px] border-border py-3.5 text-center font-display text-[13.5px] font-bold text-foreground">
            Done
          </button>
          <button type="button" onClick={onUseWinner} className="flex-[1.4] rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground">
            Use Winning Option →
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            <div className="font-display text-xl font-extrabold tabular-nums text-foreground">{poll.totalTenants}</div>
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">Total tenants</div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            <div className="font-display text-xl font-extrabold tabular-nums text-foreground">{poll.votes}</div>
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">Total votes</div>
          </div>
          <div className="flex-1 rounded-2xl bg-foreground p-3.5">
            <div className="font-display text-xl font-extrabold tabular-nums text-background">{participation}%</div>
            <div className="mt-0.5 text-[10.5px] text-background/70">Participation</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3.5">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary">
            <Trophy className="h-5 w-5 text-primary-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Winning option</div>
            <div className="font-display text-base font-extrabold tracking-tight text-foreground">{winner.name}</div>
          </div>
          <div className="font-display text-xl font-extrabold text-primary">{winner.pct}%</div>
        </div>

        <div className="flex flex-col gap-3.5">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vote breakdown</span>
          {poll.options.map((o) => {
            const isWinner = o.id === winner.id;
            return (
              <div key={o.id}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className={`text-[13px] font-semibold ${isWinner ? 'text-foreground' : 'text-foreground/80'}`}>{o.name}</span>
                  <span className={`font-display text-[13px] font-extrabold tabular-nums ${isWinner ? 'text-primary' : 'text-muted-foreground'}`}>{o.pct}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full transition-all ${isWinner ? 'bg-primary' : 'bg-border'}`} style={{ width: `${o.pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </BottomSheet>
  );
}
