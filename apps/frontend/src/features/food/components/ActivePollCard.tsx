import { Check } from 'lucide-react';
import type { TenantPoll } from '../hooks/useTenantFoodPolls';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

interface ActivePollCardProps {
  poll: TenantPoll;
  onToggleVote: (optionId: string) => void;
  isVoting: boolean;
}

/**
 * One real, editable food poll — the single tenant-facing surface for
 * `useTenantFoodPolls()`, mounted identically on the tenant Dashboard and
 * Food page so both always show the same poll/vote state (same React Query
 * key, no separate poll implementations). Always tap-to-toggle, matching
 * `POST /api/food/tenant/polls/:id/vote`'s semantics — a tenant may change
 * their vote any time while the poll is open, so there is no "voted, locked"
 * state, unlike the retired lunch-voting section this replaces.
 */
export function ActivePollCard({ poll, onToggleVote, isVoting }: ActivePollCardProps) {
  return (
    <div className={`${card} p-[18px]`}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-bold text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" /> Voting open
      </span>
      <p className="mt-2.5 font-display text-[14px] font-bold text-foreground">{poll.title}</p>
      <div className="mt-3.5 flex flex-col gap-2">
        {poll.options.map((option) => {
          const active = poll.myOptionIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={isVoting}
              onClick={() => onToggleVote(option.id)}
              className={`flex items-center gap-3 rounded-[14px] p-[13px_14px] text-left disabled:opacity-60 ${active ? 'border-[1.5px] border-primary bg-secondary/40' : 'border border-[#EAE1D8] bg-card'}`}
            >
              <span className="flex-1 font-display text-[14px] font-bold text-foreground">{option.label}</span>
              <span
                className={`flex h-[22px] w-[22px] flex-none items-center justify-center ${poll.allow_multiple ? 'rounded-[7px]' : 'rounded-full'} ${active ? 'bg-[#A45D44]' : 'border-2 border-[#DCD1C4]'}`}
              >
                {active && (poll.allow_multiple ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : <span className="h-[10px] w-[10px] rounded-full bg-white" />)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
