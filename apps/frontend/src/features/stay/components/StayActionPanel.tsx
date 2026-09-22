import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { playSuccessFeedback } from '@shared/ui-patterns/successFeedback';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import {
  MORE_ACTION_LABEL, screenFor, shouldAskGuardianConsent, type MoreAction, type ReturnDateMode,
} from '../stayState';
import type { GuardianConsent, LeaveType, TenantStay, TenantStayEventInput } from '../types';
import { GuardianConsentSheet } from './GuardianConsentSheet';
import { ReturnDateSheet } from './ReturnDateSheet';

interface StayActionPanelProps {
  stay: TenantStay;
  hostelName: string;
  source: 'QR' | 'APP';
  /** `full` is the QR screen (one huge button); `card` is a Tenant Home block. */
  variant: 'full' | 'card';
  onRecord: (input: TenantStayEventInput) => Promise<unknown>;
  busy: boolean;
  /** ADR-233. Null when there is no guardian on file. */
  guardian: GuardianConsent | null;
  onGuardianConsent: (granted: boolean) => Promise<unknown>;
}

/**
 * One status line, at most one button, everything else behind More.
 * I'm back is optimistic — the welcome shows on the tap, and only an error
 * takes it back — because the two-second rule is about how it feels.
 * See ADR-194.
 */
export function StayActionPanel({
  stay, hostelName, source, variant, onRecord, busy, guardian, onGuardianConsent,
}: StayActionPanelProps) {
  const screen = screenFor(stay, hostelName);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState<ReturnDateMode | null>(null);
  const [welcomed, setWelcomed] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ type: LeaveType; date: string } | null>(null);
  const full = variant === 'full';

  const send = async (input: Omit<TenantStayEventInput, 'source' | 'idempotencyKey'>) => {
    try {
      await onRecord({ ...input, source, idempotencyKey: crypto.randomUUID() });
      playSuccessFeedback();
      return true;
    } catch (error) {
      stayoToast.error(parseApiError(error) || 'Could not update your stay. Try again.');
      return false;
    }
  };

  const imBack = async () => {
    setWelcomed(true);
    if (!(await send({ type: 'RETURNED' }))) setWelcomed(false);
  };

  const choose = (action: MoreAction) => {
    setMoreOpen(false);
    if (action === 'CANCEL_LEAVE') void send({ type: 'LEAVE_CANCELLED' });
    else setSheet(action);
  };

  /**
   * ADR-233 D6: a channel that reports on you is never invisible to you. Shown
   * on every leave that actually notifies, not only the trip where consent was
   * given.
   */
  const notedGuardian = () => {
    if (guardian?.consent !== 'GRANTED') return;
    stayoToast.success(`${(guardian.name || '').trim() || 'Your guardian'} will be told.`);
  };

  const startLeave = async (mode: LeaveType, date: string, announce: boolean) => {
    const sent = await send({ type: 'LEAVE_STARTED', leaveType: mode, expectedReturnDate: date });
    if (sent && announce) notedGuardian();
    return sent;
  };

  const pickDate = (date: string) => {
    const mode = sheet;
    setSheet(null);
    if (mode === 'CHANGE_DATE') {
      // Silent by design — a changed date does not reach the guardian.
      void send({ type: 'RETURN_DATE_CHANGED', expectedReturnDate: date });
      return;
    }
    if (!mode) return;
    if (shouldAskGuardianConsent(guardian)) {
      setPendingLeave({ type: mode, date });
      return;
    }
    void startLeave(mode, date, true);
  };

  const decideConsent = async (granted: boolean) => {
    const leave = pendingLeave;
    setPendingLeave(null);
    // The decision is recorded first and separately: a declined consent must
    // survive a leave that then fails, or the tenant is asked again next time
    // having already said no.
    try {
      await onGuardianConsent(granted);
    } catch {
      // Recording the decision failed. The leave is still what they asked for,
      // so it goes ahead; they will simply be asked once more next time.
    }
    if (!leave) return;
    const sent = await startLeave(leave.type, leave.date, false);
    if (sent && granted) {
      stayoToast.success(`${(guardian?.name || '').trim() || 'Your guardian'} will be told.`);
    }
  };

  const showWelcome = welcomed && screen.kind === 'present';
  const headline = showWelcome ? 'Welcome back' : screen.headline;

  return (
    <div className={full ? 'flex w-full flex-col items-center gap-8 text-center' : 'rounded-2xl border border-border bg-card p-4'}>
      <div className={full ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3'}>
        {(screen.kind === 'present' || showWelcome) && (
          <span className={`flex flex-none items-center justify-center rounded-full bg-success/10 text-success ${full ? 'h-20 w-20' : 'h-9 w-9'}`}>
            <Check className={full ? 'h-10 w-10' : 'h-5 w-5'} strokeWidth={2.4} />
          </span>
        )}
        <div className={full ? '' : 'min-w-0 flex-1'}>
          <p className={full ? 'font-display text-4xl font-extrabold tracking-tight' : 'text-[15px] font-bold text-foreground'}>{headline}</p>
          <p className={full ? 'mt-1 text-base text-muted-foreground' : 'text-[13px] text-muted-foreground'}>{screen.detail}</p>
        </div>
      </div>

      {screen.primary === 'IM_BACK' && !showWelcome && (
        <button
          type="button"
          onClick={imBack}
          disabled={busy}
          className={
            full
              ? 'h-20 w-full rounded-3xl bg-primary text-xl font-extrabold text-primary-foreground shadow-lg active:scale-[0.99] disabled:opacity-60'
              : 'mt-3 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-60'
          }
        >
          I'm back
        </button>
      )}

      <div className={full ? 'w-full' : 'mt-2'}>
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          className="flex w-full items-center justify-center gap-1 py-2 text-[13px] font-semibold text-muted-foreground"
        >
          More <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
        </button>
        {moreOpen && (
          <div className="flex flex-col gap-2">
            {screen.more.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() => choose(action)}
                className="h-12 w-full rounded-xl border border-border bg-card text-[15px] font-semibold text-foreground disabled:opacity-60"
              >
                {MORE_ACTION_LABEL[action]}
              </button>
            ))}
          </div>
        )}
      </div>

      {pendingLeave && (
        <GuardianConsentSheet
          guardianName={guardian?.name ?? null}
          busy={busy}
          onDecide={(granted) => void decideConsent(granted)}
        />
      )}

      {sheet && (
        <ReturnDateSheet
          mode={sheet}
          suggested={stay.suggestedReturn}
          minDate={stay.minReturnDate}
          maxDate={stay.maxReturnDate}
          initialDate={sheet === 'CHANGE_DATE' ? stay.leave?.expectedReturnDate : undefined}
          onPick={pickDate}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
