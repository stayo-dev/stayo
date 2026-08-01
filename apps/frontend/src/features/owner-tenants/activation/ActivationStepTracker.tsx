import { Check, Circle, Dot, Lock } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { kycBadge, toActivationProgress, type StepStatus } from './activationProgress';

interface ActivationStepTrackerProps {
  state: unknown;
  documentVerified: boolean;
  compact?: boolean;
}

const ICON: Record<StepStatus, typeof Check> = {
  done: Check,
  current: Dot,
  blocked: Lock,
  pending: Circle,
};

const TONE: Record<StepStatus, string> = {
  done: 'text-success',
  current: 'text-primary',
  blocked: 'text-muted-foreground/50',
  pending: 'text-muted-foreground/50',
};

/**
 * Where this tenant is in activation, and — separately — where their KYC is.
 *
 * Every value shown comes from the backend's own state machine; this component
 * renders `completed_steps` / `current_step` / `blocked_steps` and does not
 * decide any of them. KYC is rendered as its own badge because it is an
 * independent state machine that never gates activation.
 */
export function ActivationStepTracker({ state, documentVerified, compact }: ActivationStepTrackerProps) {
  const progress = toActivationProgress(state);
  const kyc = kycBadge(documentVerified);

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Activation</div>
          <div className="mt-0.5 font-display text-[14.5px] font-bold text-foreground">{progress.currentLabel}</div>
        </div>
        <StatusPill tone={kyc.tone} variant="filter">
          {kyc.label}
        </StatusPill>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
      </div>

      {!compact && (
        <div className="flex flex-col gap-1.5">
          {progress.steps.map(({ step, shortLabel, label, status }) => {
            const Icon = ICON[status];
            return (
              <div key={step} className="flex items-center gap-2.5">
                <Icon className={`h-3.5 w-3.5 flex-none ${TONE[status]}`} strokeWidth={status === 'done' ? 3 : 2} />
                <span
                  className={`text-[12.5px] ${
                    status === 'current'
                      ? 'font-bold text-foreground'
                      : status === 'done'
                        ? 'font-medium text-muted-foreground line-through'
                        : 'text-muted-foreground/70'
                  }`}
                >
                  {shortLabel}
                </span>
                {status === 'current' && (
                  <span className="text-[11px] text-muted-foreground">— {label.replace('Waiting for ', 'awaiting ')}</span>
                )}
                {status === 'blocked' && <span className="text-[10.5px] text-muted-foreground/60">blocked</span>}
              </div>
            );
          })}
        </div>
      )}

      {progress.missingFields.length > 0 && (
        <p className="rounded-[10px] bg-muted/60 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
          Still missing: <b className="font-semibold text-foreground">{progress.missingFields.join(', ')}</b>
        </p>
      )}
    </div>
  );
}
