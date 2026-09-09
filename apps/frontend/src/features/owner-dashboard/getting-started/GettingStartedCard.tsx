import { forwardRef } from 'react';
import { ArrowRight, BadgeCheck, Check, Clock, Compass, ShieldAlert, ShieldQuestion } from 'lucide-react';
import type { GettingStarted, GettingStartedStep, StepId, VerificationStatus } from './gettingStarted';

/**
 * The new owner's next three steps, on their real dashboard.
 *
 * Replaces `FirstHostelCard` rather than sitting beside it — step one's
 * incomplete state *is* what that card said, and two "start here" prompts on
 * one screen is one too many.
 *
 * Only the current step carries a button. Showing a call to action on every
 * row turns a sequence into a menu, and the whole point is that these happen
 * in order.
 *
 * Two things here are written against the audience rather than the pattern.
 * Finished steps are **not** struck through: to someone who does not read UI
 * for a living, a line through their own hostel's name reads as cancelled,
 * not completed — a green tick and a quieter tone say "done" without saying
 * "void". And every row is **numbered**, because "step 2 of 3" in the corner
 * only means something if the rows it counts are countable.
 */

const TONE_STYLES: Record<
  VerificationStatus['tone'],
  { icon: typeof Clock; text: string; chip: string }
> = {
  neutral: { icon: ShieldQuestion, text: 'text-muted-foreground', chip: 'bg-muted' },
  pending: { icon: Clock, text: 'text-muted-foreground', chip: 'bg-muted' },
  success: { icon: BadgeCheck, text: 'text-success', chip: 'bg-success-bg' },
  warning: { icon: ShieldAlert, text: 'text-warning', chip: 'bg-warning-bg' },
};

interface GettingStartedCardProps {
  state: GettingStarted;
  verification: VerificationStatus;
  onStep: (id: StepId) => void;
  /**
   * Replays the orientation tour. Absent while the tour has never run or is
   * running now — offering to "show me around" mid-tour is noise.
   */
  onReplayTour?: () => void;
}

export const GettingStartedCard = forwardRef<HTMLElement, GettingStartedCardProps>(
  function GettingStartedCard({ state, verification, onStep, onReplayTour }, ref) {
    if (!state.visible) return null;

    const tone = TONE_STYLES[verification.tone];
    const ToneIcon = tone.icon;
    const stepNumber = Math.min(state.doneCount + 1, state.total);
    const remaining = state.total - state.doneCount;

    return (
      <section
        ref={ref}
        aria-label="Getting started"
        className="overflow-hidden rounded-[22px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_8px_20px_rgba(40,30,20,0.05)]"
      >
        <div className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[17px] font-extrabold tracking-[-0.01em] text-foreground">
              Getting started
            </h2>
            {/* "Step 2 of 3" rather than "1 of 3" — a count of what is finished
                reads as a score, and on day one that score is zero. Naming the
                step they are on says the same thing forwards. */}
            <span className="flex-none font-display text-[12px] font-bold text-muted-foreground">
              Step {stepNumber} of {state.total}
            </span>
          </div>

          {/* Says what the bar means. A bare bar is a decoration; one sentence
              turns it into a promise about how much is left. */}
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {remaining === 1
              ? 'One last thing and your hostel is running on Stayo.'
              : `${remaining} short steps and your hostel is running on Stayo.`}
          </p>

          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuenow={state.doneCount}
            aria-valuemin={0}
            aria-valuemax={state.total}
            aria-valuetext={`${state.doneCount} of ${state.total} steps done`}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${state.percent}%` }}
            />
          </div>

          <ol className="mt-4 flex flex-col gap-1">
            {state.steps.map((step, i) => (
              <StepRow key={step.id} step={step} number={i + 1} onAction={() => onStep(step.id)} />
            ))}
          </ol>
        </div>

        {/* Reported, not asked for — an admin decides this, not the owner. On
            its own tinted footer rather than inside the list, so it cannot be
            mistaken for a fourth thing to do. */}
        <div className={`flex items-start gap-2.5 border-t border-border px-5 py-3.5 ${tone.chip}`}>
          <ToneIcon className={`mt-0.5 h-4 w-4 flex-none ${tone.text}`} strokeWidth={2} />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            <span className={`font-bold ${tone.text}`}>{verification.label}</span>
            {' · '}
            {verification.detail}
          </p>
        </div>

        {/* A tour that runs once and can never be reached again is a tour most
            owners meet while doing something else and dismiss unread. This is
            the way back to it. */}
        {onReplayTour && (
          <button
            type="button"
            onClick={onReplayTour}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border py-3 font-display text-[12.5px] font-bold text-primary active:bg-muted"
          >
            <Compass className="h-3.5 w-3.5" strokeWidth={2.2} />
            Show me around again
          </button>
        )}
      </section>
    );
  },
);

function StepRow({
  step,
  number,
  onAction,
}: {
  step: GettingStartedStep;
  number: number;
  onAction: () => void;
}) {
  const done = step.state === 'done';
  const current = step.state === 'current';

  return (
    <li
      className={`flex items-start gap-3 rounded-[14px] px-2.5 py-2.5 transition-colors ${
        current ? 'bg-primary/[0.06]' : ''
      }`}
    >
      <span
        aria-hidden
        className={`mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full font-display text-[11px] font-extrabold ${
          done
            ? 'bg-success text-success-foreground'
            : current
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-card text-muted-foreground'
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3.2} /> : number}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block font-display text-[14px] font-bold ${
            done ? 'text-muted-foreground' : 'text-foreground'
          }`}
        >
          {step.title}
          {done && <span className="sr-only"> — done</span>}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">{step.detail}</span>

        {/* The reason and the time estimate ride on the current step only.
            Repeating them on every row turns three short instructions into a
            page of small print, and the steps that are not next yet do not
            need justifying — the owner is not being asked to do them. */}
        {current && step.why && (
          <span className="mt-1.5 block text-[12.5px] leading-relaxed text-foreground/75">{step.why}</span>
        )}

        {current && (
          <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={onAction}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-primary px-4 font-display text-[13.5px] font-bold text-primary-foreground shadow-sm active:scale-[0.98] transition-transform"
            >
              {step.cta}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>
            {step.duration && (
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" strokeWidth={1.9} />
                {step.duration}
              </span>
            )}
          </span>
        )}
      </span>
    </li>
  );
}
