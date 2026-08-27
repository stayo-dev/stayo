import { Clock3, Pencil, Trophy } from 'lucide-react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { getPollWinner, optionPercent, POLL_TYPE_META, type PollRow } from '../../polls/pollTypes';
import { mealIcon } from '../../mealIcons';

function slotOf(mealType: string): MealSlotKey {
  return mealType.toLowerCase() as MealSlotKey;
}

function closesLabel(poll: PollRow): string {
  if (poll.status === 'CLOSED') return 'Closed';
  const diffMs = new Date(poll.closes_at).getTime() - Date.now();
  if (diffMs <= 0) return 'Closing…';
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'Closes soon';
  if (hours < 24) return `Closes in ${hours}h`;
  return `Closes ${new Date(poll.closes_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

interface PollCardProps {
  poll: PollRow;
  onViewResults: () => void;
  onClose: () => void;
  onEdit: () => void;
}

/** One Food Poll card — stats, status badge, winner banner if closed, footer actions gated by status. Editing (via `onEdit`) is only offered while OPEN. */
export function PollCard({ poll, onViewResults, onClose, onEdit }: PollCardProps) {
  const mealMeta = MEAL_CATEGORY_META[slotOf(poll.meal_type)];
  const winner = getPollWinner(poll.options);
  const participation = poll.eligibleCount ? Math.round((poll.voterCount / poll.eligibleCount) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {(() => { const I = mealIcon(slotOf(poll.meal_type)); return <I className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={1.75} />; })()}{mealMeta.label}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${poll.status === 'OPEN' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
              {poll.status === 'OPEN' ? 'Live' : 'Closed'}
            </span>
          </div>
          <span className="font-display text-base font-extrabold tracking-tight text-foreground">{poll.title}</span>
          <span className="text-[11.5px] text-muted-foreground">
            {POLL_TYPE_META[poll.poll_type].label} · {new Date(poll.poll_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        </div>

        <div className="flex items-center gap-3.5 border-t border-border pt-3">
          <div className="flex-1">
            <div className="font-display text-[17px] font-extrabold tabular-nums text-foreground">{poll.voterCount}</div>
            <div className="text-[10.5px] text-muted-foreground">of {poll.eligibleCount} voted</div>
          </div>
          <div className="flex-1">
            <div className="font-display text-[17px] font-extrabold tabular-nums text-foreground">{participation}%</div>
            <div className="text-[10.5px] text-muted-foreground">participation</div>
          </div>
          <div className="flex flex-[1.3] items-center justify-end gap-1 text-[11.5px] font-semibold text-muted-foreground">
            <Clock3 className="h-3 w-3" /> {closesLabel(poll)}
          </div>
        </div>

        {poll.status === 'CLOSED' && winner && (
          <div className="flex items-center gap-2.5 rounded-xl border border-warning/25 bg-warning/10 px-3.5 py-2.5">
            <Trophy className="h-4 w-4 flex-none text-warning" />
            <span className="text-xs font-semibold text-foreground">
              Winner · <b>{winner.label}</b> ({optionPercent(winner, poll.options)}%)
            </span>
          </div>
        )}
      </div>

      <div className="flex border-t border-border">
        <button type="button" onClick={onViewResults} className="flex-1 py-3 text-center font-display text-[12.5px] font-bold text-primary">
          View Results
        </button>
        {poll.status === 'OPEN' && (
          <>
            <button type="button" onClick={onEdit} className="flex flex-1 items-center justify-center gap-1.5 border-l border-border py-3 text-center font-display text-[12.5px] font-bold text-foreground">
              <Pencil className="h-3.5 w-3.5" /> Edit Poll
            </button>
            <button type="button" onClick={onClose} className="flex-1 border-l border-border py-3 text-center font-display text-[12.5px] font-bold text-destructive">
              Close Poll
            </button>
          </>
        )}
      </div>
    </div>
  );
}
