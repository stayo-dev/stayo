import { useState } from 'react';
import { CheckCircle2, Vote } from 'lucide-react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import type { useFoodVoting } from '../../hooks/useFoodVoting';
import { mealIcon } from '../../mealIcons';

interface VotingPanelProps {
  voting: ReturnType<typeof useFoodVoting>;
  monthLabel: string;
}

const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

function defaultStart() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
}
function defaultEnd() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
}

/** Owner "Voting" section — open a monthly vote, watch a live per-meal-type tally, close it when ready to generate. */
export function VotingPanel({ voting, monthLabel }: VotingPanelProps) {
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);

  if (voting.isLoading) {
    return <div className="h-32 animate-pulse rounded-2xl bg-muted" />;
  }

  if (!voting.period) {
    return (
      <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-secondary text-primary">
            <Vote className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div>
            <div className="font-display text-sm font-bold text-foreground">Voting for {monthLabel}</div>
            <div className="text-[11.5px] text-muted-foreground">Not started yet</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelStyle}>Starts</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputStyle} />
          </label>
          <label className="block">
            <span className={labelStyle}>Ends</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputStyle} />
          </label>
        </div>
        <button
          type="button"
          disabled={voting.isOpening}
          onClick={() => voting.openVoting(new Date(startsAt).toISOString(), new Date(endsAt).toISOString())}
          className="rounded-xl bg-primary py-3 text-center font-display text-[13px] font-bold text-primary-foreground disabled:opacity-50"
        >
          {voting.isOpening ? 'Opening…' : 'Open Voting'}
        </button>
      </div>
    );
  }

  const isOpen = voting.period.status === 'OPEN';
  const tallyBySlot = voting.results?.byMealType ?? {};

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-9 w-9 items-center justify-center rounded-[11px] ${isOpen ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
            {isOpen ? <Vote className="h-4 w-4" strokeWidth={1.8} /> : <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />}
          </span>
          <div>
            <div className="font-display text-sm font-bold text-foreground">Voting for {monthLabel}</div>
            <div className="text-[11.5px] text-muted-foreground">
              {isOpen ? `Open until ${new Date(voting.period.voting_ends_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Closed'}
            </div>
          </div>
        </div>
        {isOpen && (
          <button
            type="button"
            disabled={voting.isClosing}
            onClick={voting.closeVoting}
            className="flex-none rounded-lg border border-border px-3 py-2 font-display text-[11.5px] font-bold text-foreground disabled:opacity-50"
          >
            {voting.isClosing ? 'Closing…' : 'Close Voting'}
          </button>
        )}
      </div>

      {(voting.results?.totalVotes ?? 0) === 0 ? (
        <p className="text-[12px] text-muted-foreground">No votes yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {(Object.keys(MEAL_CATEGORY_META) as MealSlotKey[]).map((slot) => {
            const rows = tallyBySlot[slot.toUpperCase()] ?? [];
            if (rows.length === 0) return null;
            const max = Math.max(...rows.map((r) => r.votes));
            return (
              <div key={slot} className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  {(() => { const I = mealIcon(slot); return <I className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={1.75} />; })()}{MEAL_CATEGORY_META[slot].label}
                </span>
                {rows.map((row) => (
                  <div key={row.menu_item_id} className="flex items-center gap-2">
                    <span className="w-24 flex-none truncate text-[12px] font-semibold text-foreground">{row.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(row.votes / max) * 100}%` }} />
                    </div>
                    <span className="w-6 flex-none text-right text-[11px] font-bold tabular-nums text-muted-foreground">{row.votes}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
