import { Check } from 'lucide-react';
import { STAGES, STAGE_LABELS, stepNumber, type Navigation, type Stage } from '../importStages';

interface StepBarProps {
  nav: Navigation;
  onGo: (stage: Stage) => void;
}

/**
 * Where the owner is, in the width of a phone.
 *
 * Six numbered circles with the current one's label beside it does not fit at
 * 390px: the label ran into the next circle and the flow opened reading
 * "2 Get the 3 ject 4 5 6". Two lines solve what one line could not — the step
 * says its own name in full above a bar that carries the shape of the whole
 * journey, so nothing has to be truncated and nothing collides.
 *
 * The segments are buttons wherever the owner has already been. A stepper that
 * shows six steps and lets you touch none of them is a picture of navigation
 * rather than navigation.
 */
export function StepBar({ nav, onGo }: StepBarProps) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="font-display text-[15px] font-bold text-foreground">
          {STAGE_LABELS[nav.current]}
        </p>
        <p className="flex-none text-[11.5px] font-semibold tabular-nums text-muted-foreground">
          Step {stepNumber(nav.current)} of {STAGES.length}
        </p>
      </div>

      <ol className="flex items-center gap-1" aria-label="Import progress">
        {STAGES.map((stage) => {
          const index = STAGES.indexOf(stage);
          const done = index < STAGES.indexOf(nav.current);
          const here = stage === nav.current;
          const canGo = nav.reachable.includes(stage) && !here;

          return (
            <li key={stage} className="flex-1">
              <button
                type="button"
                disabled={!canGo}
                onClick={() => onGo(stage)}
                aria-current={here ? 'step' : undefined}
                aria-label={`Step ${stepNumber(stage)}, ${STAGE_LABELS[stage]}${
                  done ? ' — done' : ''
                }${canGo ? '' : ', not available yet'}`}
                // The bar is 4px but the target is the full height of the row:
                // a 4px tap target is not one.
                className={`flex w-full items-center py-2 ${canGo ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span
                  className={`h-1 w-full rounded-full transition-colors ${
                    done ? 'bg-primary' : here ? 'bg-foreground' : 'bg-muted'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ol>

      {/* Named only for a screen reader: the bar above carries this visually,
          and repeating six labels on a phone is what broke the old stepper. */}
      <p className="sr-only">
        {nav.reachable.map((stage) => `${stepNumber(stage)} ${STAGE_LABELS[stage]}`).join(', ')} completed or
        available.
      </p>
    </div>
  );
}

/**
 * The line that appears when the owner has stepped back to re-read something.
 *
 * Without it, going back looks like losing your place — the step content is
 * the same as it was, and nothing says the work ahead is still there.
 */
export function LookingBackBar({ nav, onGo }: StepBarProps) {
  if (!nav.forward) return null;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
      <p className="text-[12.5px] font-medium text-muted-foreground">
        Nothing here is lost — you were on{' '}
        <span className="font-bold text-foreground">{STAGE_LABELS[nav.furthest]}</span>.
      </p>
      <button
        type="button"
        onClick={() => onGo(nav.furthest)}
        className="flex-none rounded-lg bg-foreground px-3 py-1.5 font-display text-[12.5px] font-bold text-background"
      >
        <Check className="mr-1 inline h-3 w-3" strokeWidth={3} />
        Go back to it
      </button>
    </div>
  );
}
