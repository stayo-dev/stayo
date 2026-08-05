import { Clock3, Trophy } from 'lucide-react';
import { MEAL_CATEGORY_META, POLL_TYPE_META, getPollWinner, type MockFoodPoll } from '@shared/mocks/food';
import { mealIcon } from '../../mealIcons';

const BADGE_TONE: Record<MockFoodPoll['status'], { label: string; className: string }> = {
  active: { label: 'Live', className: 'bg-success/10 text-success' },
  scheduled: { label: 'Scheduled', className: 'bg-warning/10 text-warning' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
};

interface PollCardProps {
  poll: MockFoodPoll;
  onViewResults: () => void;
  onEdit: () => void;
  onClose: () => void;
}

/** One Food Poll card — stats, status badge, winner banner if closed, footer actions gated by status. */
export function PollCard({ poll, onViewResults, onEdit, onClose }: PollCardProps) {
  const badge = BADGE_TONE[poll.status];
  const mealMeta = MEAL_CATEGORY_META[poll.mealCat];
  const winner = getPollWinner(poll);
  const participation = poll.totalTenants ? Math.round((poll.votes / poll.totalTenants) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {(() => { const I = mealIcon(poll.mealCat); return <I className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={1.75} />; })()}{mealMeta.label}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
          </div>
          <span className="font-display text-base font-extrabold tracking-tight text-foreground">{poll.title}</span>
          <span className="text-[11.5px] text-muted-foreground">
            {POLL_TYPE_META[poll.type].label} · {poll.date}
          </span>
        </div>

        <div className="flex items-center gap-3.5 border-t border-border pt-3">
          <div className="flex-1">
            <div className="font-display text-[17px] font-extrabold tabular-nums text-foreground">{poll.votes}</div>
            <div className="text-[10.5px] text-muted-foreground">of {poll.totalTenants} voted</div>
          </div>
          <div className="flex-1">
            <div className="font-display text-[17px] font-extrabold tabular-nums text-foreground">{participation}%</div>
            <div className="text-[10.5px] text-muted-foreground">participation</div>
          </div>
          <div className="flex flex-[1.3] items-center justify-end gap-1 text-[11.5px] font-semibold text-muted-foreground">
            <Clock3 className="h-3 w-3" /> {poll.closeIn}
          </div>
        </div>

        {poll.status === 'closed' && (
          <div className="flex items-center gap-2.5 rounded-xl border border-warning/25 bg-warning/10 px-3.5 py-2.5">
            <Trophy className="h-4 w-4 flex-none text-warning" />
            <span className="text-xs font-semibold text-foreground">
              Winner · <b>{winner.name}</b> ({winner.pct}%)
            </span>
          </div>
        )}
      </div>

      <div className="flex border-t border-border">
        <button type="button" onClick={onViewResults} className="flex-1 py-3 text-center font-display text-[12.5px] font-bold text-primary">
          View Results
        </button>
        {poll.status === 'active' && (
          <>
            <button type="button" onClick={onEdit} className="flex-1 border-l border-border py-3 text-center font-display text-[12.5px] font-bold text-foreground">
              Edit
            </button>
            <button type="button" onClick={onClose} className="flex-1 border-l border-border py-3 text-center font-display text-[12.5px] font-bold text-destructive">
              Close Poll
            </button>
          </>
        )}
        {poll.status === 'scheduled' && (
          <button type="button" onClick={onEdit} className="flex-1 border-l border-border py-3 text-center font-display text-[12.5px] font-bold text-foreground">
            Edit
          </button>
        )}
      </div>
    </div>
  );
}
