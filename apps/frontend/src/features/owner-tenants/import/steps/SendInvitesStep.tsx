import { Send } from 'lucide-react';
import type { ProgressView } from '../importProgress';

interface SendInvitesStepProps {
  progress: ProgressView;
  waiting: number;
  sent: number;
  busy: boolean;
  onSendAll: () => void;
  onSendWave: () => void;
  onClose: () => void;
}

/**
 * The tenants exist; nobody has been told yet.
 *
 * That separation is the point of the whole deferred-dispatch design — an
 * owner onboarding a running hostel gets their books right immediately without
 * forty phones buzzing at once. So this screen has to be unambiguous about
 * which of those two things has happened.
 */
export function SendInvitesStep({
  progress,
  waiting,
  sent,
  busy,
  onSendAll,
  onSendWave,
  onClose,
}: SendInvitesStepProps) {
  const none = waiting <= 0;

  return (
    <div className="space-y-4">
      <p className="font-display text-sm font-bold text-foreground">{progress.headline}</p>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-display text-[13.5px] font-bold text-foreground">
          {none
            ? 'Every invitation has been sent'
            : `${waiting.toLocaleString('en-IN')} ${waiting === 1 ? 'invitation is' : 'invitations are'} ready to send`}
        </p>
        <p className="mt-1 text-[12.5px] font-medium text-muted-foreground">
          {none
            ? 'Your tenants can now set up their accounts.'
            : 'Your tenants are set up and their rent is being tracked — they just haven’t been messaged yet. Each one gets a week to accept from the moment you send.'}
        </p>
        {sent > 0 && !none && (
          <p className="mt-2 text-[12px] font-semibold text-muted-foreground">
            {sent.toLocaleString('en-IN')} sent so far.
          </p>
        )}
      </div>

      {!none && (
        <>
          <button
            type="button"
            onClick={onSendAll}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {busy ? 'Sending…' : `Send all ${waiting.toLocaleString('en-IN')}`}
          </button>
          <button
            type="button"
            onClick={onSendWave}
            disabled={busy}
            className="w-full rounded-xl border border-border py-3.5 font-display text-sm font-bold text-foreground disabled:opacity-50"
          >
            Send the first 10
          </button>
          <p className="text-center text-[12px] font-medium text-muted-foreground">
            Sending a few first lets you check how the message lands before the rest go out.
          </p>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full text-center text-[12.5px] font-semibold text-muted-foreground underline"
      >
        {none ? 'Close' : 'I’ll send these later'}
      </button>
    </div>
  );
}
