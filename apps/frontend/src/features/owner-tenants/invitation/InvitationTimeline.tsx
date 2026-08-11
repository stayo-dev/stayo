import { Check } from 'lucide-react';
import type { ProgressStep } from './invitationWorkspace';

/**
 * The invitation's delivery funnel, drawn from what the backend already
 * records (`opened_at`, `activation_started_at`). This answers the owner's
 * real question — "have they even looked at it?" — which the screen used to
 * replace with a fixed sentence.
 */
export function InvitationTimeline({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const done = step.state === 'done';
        const current = step.state === 'current';

        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={[
                  'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
                  done
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : current
                      ? 'border-warning bg-warning/15'
                      : 'border-border bg-card',
                ].join(' ')}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                {current ? <span className="h-1.5 w-1.5 rounded-full bg-warning" /> : null}
              </span>
              {!isLast && (
                <span
                  aria-hidden
                  className={`w-0.5 flex-1 ${done ? 'bg-emerald-600/40' : 'bg-border'}`}
                  style={{ minHeight: 18 }}
                />
              )}
            </div>

            <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-3'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-[13.5px] leading-5 ${
                    done || current ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
                <span className="shrink-0 text-[11.5px] font-semibold text-muted-foreground">
                  {step.at ?? (current ? 'not yet' : '')}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
