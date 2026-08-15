import { forwardRef } from 'react';
import { ArrowRight, BadgeCheck, Check, Clock, ShieldAlert, ShieldQuestion } from 'lucide-react';
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
 */

const TONE_STYLES: Record<VerificationStatus['tone'], { icon: typeof Clock; className: string }> = {
  neutral: { icon: ShieldQuestion, className: 'text-muted-foreground' },
  pending: { icon: Clock, className: 'text-muted-foreground' },
  success: { icon: BadgeCheck, className: 'text-success' },
  warning: { icon: ShieldAlert, className: 'text-warning' },
};

interface GettingStartedCardProps {
  state: GettingStarted;
  verification: VerificationStatus;
  onStep: (id: StepId) => void;
}

export const GettingStartedCard = forwardRef<HTMLElement, GettingStartedCardProps>(
  function GettingStartedCard({ state, verification, onStep }, ref) {
    if (!state.visible) return null;

    const tone = TONE_STYLES[verification.tone];
    const ToneIcon = tone.icon;

    return (
      <section
        ref={ref}
        aria-label="Getting started"
        className="rounded-[22px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_8px_20px_rgba(40,30,20,0.05)]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[17px] font-extrabold text-foreground">Getting started</h2>
          <span className="text-[12px] font-bold text-muted-foreground">
            {state.doneCount} of {state.total}
          </span>
        </div>

        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={state.doneCount}
          aria-valuemin={0}
          aria-valuemax={state.total}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${state.percent}%` }}
          />
        </div>

        <ol className="mt-4 flex flex-col gap-3.5">
          {state.steps.map((step) => (
            <StepRow key={step.id} step={step} onAction={() => onStep(step.id)} />
          ))}
        </ol>

        {/* Reported, not asked for — an admin decides this, not the owner. */}
        <div className="mt-4 flex items-start gap-2.5 border-t border-border/70 pt-3.5">
          <ToneIcon className={`mt-0.5 h-4 w-4 flex-none ${tone.className}`} strokeWidth={2} />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            <span className={`font-bold ${tone.className}`}>{verification.label}</span>
            {' · '}
            {verification.detail}
          </p>
        </div>
      </section>
    );
  },
);

function StepRow({ step, onAction }: { step: GettingStartedStep; onAction: () => void }) {
  const done = step.state === 'done';
  const current = step.state === 'current';

  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${
          done
            ? 'border-success bg-success text-white'
            : current
              ? 'border-primary bg-primary/10'
              : 'border-border bg-card'
        }`}
      >
        {done && <Check className="h-3 w-3" strokeWidth={3.2} />}
        {current && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block font-display text-[14px] font-bold ${
            done ? 'text-muted-foreground line-through decoration-1' : 'text-foreground'
          }`}
        >
          {step.title}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">{step.detail}</span>

        {current && (
          <button
            type="button"
            onClick={onAction}
            className="mt-2.5 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-primary px-4 font-display text-[13px] font-bold text-primary-foreground shadow-sm active:scale-[0.98] transition-transform"
          >
            {step.cta}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        )}
      </span>
    </li>
  );
}
