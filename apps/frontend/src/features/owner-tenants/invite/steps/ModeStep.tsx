import { UserPlus, Home, ChevronRight } from 'lucide-react';
import type { InviteMode } from '../../types';

interface ModeStepProps {
  onChoose: (mode: InviteMode) => void;
}

/**
 * The wizard's opening question, asked before any form field.
 *
 * An owner putting an existing hostel onto Stayo spends their first week
 * entering people who moved in months ago and have already paid deposits and
 * several months of rent. That is a materially different job from admitting
 * someone new, and it used to be invisible: the wizard asked for a joining
 * date, quietly accepted a past one, and then created a single month's rent
 * obligation as though the tenant had arrived today.
 *
 * Naming the two jobs up front lets the wizard adapt to the answer, and costs
 * the common new-tenant path exactly one tap with nothing to read. See
 * ADR-141.
 */
export function ModeStep({ onChoose }: ModeStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-display text-[17px] font-extrabold text-foreground">Who are you adding?</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          This changes what we ask for next.
        </p>
      </div>

      <Choice
        icon={UserPlus}
        title="Someone new"
        body="Moving in now, or on a date coming up."
        meta="4 steps"
        onClick={() => onChoose('NEW')}
      />
      <Choice
        icon={Home}
        title="Already living here"
        body="They have been here a while and have already paid you. We'll record that too, so you don't have to enter it again later."
        meta="5 steps"
        onClick={() => onChoose('EXISTING')}
      />
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  body,
  meta,
  onClick,
}: {
  icon: typeof UserPlus;
  title: string;
  body: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors active:bg-muted"
    >
      <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4.5 w-4.5" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[14.5px] font-bold text-foreground">{title}</span>
          <span className="text-[11px] font-semibold text-muted-foreground">{meta}</span>
        </span>
        <span className="mt-1 block text-[12.5px] leading-relaxed text-muted-foreground">{body}</span>
      </span>
      <ChevronRight className="mt-2.5 h-4 w-4 flex-none text-muted-foreground" />
    </button>
  );
}
