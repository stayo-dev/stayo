import { Check } from 'lucide-react';
import { cn } from '@shared/lib/cn';

interface StepProgressProps {
  steps: string[];
  /** Zero-based index of the current step. */
  currentStep: number;
  className?: string;
}

/**
 * Numbered progress with the shared visual grammar confirmed across every
 * multi-step flow in the design source (Invite Tenant, Add Expense, Quick
 * Collect, Owner Onboarding): filled circle = current, checked/green =
 * done, pale = future, connected by a bar.
 */
export function StepProgress({ steps, currentStep, className }: StepProgressProps) {
  return (
    <div className={cn('flex items-center', className)}>
      {steps.map((label, index) => {
        const isDone = index < currentStep;
        const isCurrent = index === currentStep;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                  isDone && 'bg-success text-success-foreground',
                  isCurrent && !isDone && 'bg-primary text-primary-foreground',
                  !isCurrent && !isDone && 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  'text-[10px] font-semibold',
                  isCurrent ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className={cn('mx-2 h-0.5 flex-1', isDone ? 'bg-success' : 'bg-muted')} />
            )}
          </div>
        );
      })}
    </div>
  );
}
