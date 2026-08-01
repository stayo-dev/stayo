import { Check } from 'lucide-react';

/**
 * The five workflow steps collapse to four in the UI: RULES and AGREEMENT are
 * one visual stage ("Agreement"), because a tenant experiences accepting the
 * rules and signing as a single act. The backend keeps them distinct — this is
 * presentation only, and mirrors what the legacy page did.
 */
export type ActivationVisualStep = 'ACCOUNT' | 'RULES' | 'AGREEMENT' | 'PROFILE' | 'ACTIVATE';

const VISUAL_STEPS: { id: Exclude<ActivationVisualStep, 'RULES'>; label: string }[] = [
  { id: 'ACCOUNT', label: 'Account' },
  { id: 'AGREEMENT', label: 'Agreement' },
  { id: 'PROFILE', label: 'Profile' },
  { id: 'ACTIVATE', label: 'Activate' },
];

const ORDER: ActivationVisualStep[] = ['ACCOUNT', 'RULES', 'AGREEMENT', 'PROFILE', 'ACTIVATE'];

/** RULES and AGREEMENT share a visual index so the bar doesn't jump between them. */
function visualIndex(step: ActivationVisualStep): number {
  if (step === 'ACCOUNT') return 0;
  if (step === 'RULES' || step === 'AGREEMENT') return 1;
  if (step === 'PROFILE') return 2;
  return 3;
}

interface ActivationProgressProps {
  activeStep: ActivationVisualStep;
  /** How far the tenant has actually got — bounds what is clickable. */
  currentStep: ActivationVisualStep;
  completedSteps: Set<string>;
  onStepClick: (step: ActivationVisualStep) => void;
}

/**
 * Activation progress in the Stayo product theme.
 *
 * The legacy version used `bg-accent` plus hardcoded `emerald-*` utilities for
 * the done state — off the token scale. This uses the same semantic palette as
 * every other Stayo flow: primary = current, success = done, muted = future.
 */
export function ActivationProgress({
  activeStep,
  currentStep,
  completedSteps,
  onStepClick,
}: ActivationProgressProps) {
  const activeIdx = visualIndex(activeStep);
  const reachedIdx = visualIndex(currentStep);

  const isDone = (id: ActivationVisualStep) => completedSteps.has(id);
  const isActive = (id: ActivationVisualStep) =>
    id === 'AGREEMENT' ? activeStep === 'RULES' || activeStep === 'AGREEMENT' : activeStep === id;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-[11.5px] font-bold text-primary">
          Step {activeIdx + 1} of {VISUAL_STEPS.length}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          {VISUAL_STEPS.length - (activeIdx + 1) === 0
            ? 'Last step'
            : `${VISUAL_STEPS.length - (activeIdx + 1)} to go`}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {VISUAL_STEPS.map((step, i) => (
          <div
            key={step.id}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i <= activeIdx ? 'bg-primary' : 'bg-muted'
            }`}
          />
        ))}
      </div>

      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5">
        {VISUAL_STEPS.map((step, i) => {
          const done = isDone(step.id);
          const active = isActive(step.id);
          // Never let a tenant skip ahead of where the backend says they are.
          const clickable = visualIndex(step.id) <= reachedIdx;

          return (
            <button
              key={step.id}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (step.id === 'AGREEMENT' && (currentStep === 'RULES' || currentStep === 'AGREEMENT')) {
                  onStepClick(currentStep);
                } else {
                  onStepClick(step.id);
                }
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-display text-[11px] font-bold transition-all ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : done
                    ? 'border-success/25 bg-success/10 text-success'
                    : clickable
                      ? 'border-border bg-card text-foreground'
                      : 'cursor-not-allowed border-transparent bg-muted/40 text-muted-foreground opacity-50'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black ${
                  active
                    ? 'bg-primary-foreground text-primary'
                    : done
                      ? 'bg-success text-white'
                      : 'bg-muted-foreground/20 text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-2.5 w-2.5" strokeWidth={3.5} /> : i + 1}
              </span>
              {step.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { ORDER as ACTIVATION_STEP_ORDER, visualIndex as activationVisualIndex };
