import { useState } from 'react';
import { Check, Copy, MessageCircle, Send } from 'lucide-react';
import type { ProgressView } from '../importProgress';
import { describeSendState, type SendResult } from '../dispatchOutcome';
import {
  buildActivationShareText,
  buildWhatsAppShareUrl,
  copyActivationLink,
} from '../../invite/inviteDelivery';

interface SendInvitesStepProps {
  progress: ProgressView;
  waiting: number;
  result: SendResult | null;
  busy: boolean;
  onSendAll: () => void;
  onSendWave: () => void;
  onClose: () => void;
}

/**
 * The tenants exist; this is where they are told.
 *
 * That separation is the point of the whole deferred-dispatch design — an
 * owner onboarding a running hostel gets their books right immediately without
 * forty phones buzzing at once. So this screen has to be unambiguous about
 * which of those two things has happened, and since an owner read "Every
 * invitation has been sent" while nothing arrived, it now distinguishes
 * *attempted* from *delivered* and hands over the link for anyone the message
 * did not reach.
 */
export function SendInvitesStep({
  progress,
  waiting,
  result,
  busy,
  onSendAll,
  onSendWave,
  onClose,
}: SendInvitesStepProps) {
  const state = describeSendState({ waiting, result });
  const undelivered = result?.undelivered ?? [];
  const sentSoFar = result?.sent ?? 0;

  return (
    <div className="space-y-4">
      <p className="font-display text-sm font-bold text-foreground">{progress.headline}</p>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-display text-[13.5px] font-bold text-foreground">{state.title}</p>
        <p className="mt-1 text-[12.5px] font-medium text-muted-foreground">{state.detail}</p>
        {sentSoFar > 0 && waiting > 0 && (
          <p className="mt-2 text-[12px] font-semibold text-muted-foreground">
            {sentSoFar.toLocaleString('en-IN')} delivered so far.
          </p>
        )}
      </div>

      {undelivered.length > 0 && (
        <ul className="space-y-2.5">
          {undelivered.map((item) => (
            <UndeliveredCard key={item.invitation_id} item={item} />
          ))}
        </ul>
      )}

      {waiting > 0 && (
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
          {waiting > 10 && (
            <button
              type="button"
              onClick={onSendWave}
              disabled={busy}
              className="w-full rounded-xl border border-border py-3.5 font-display text-sm font-bold text-foreground disabled:opacity-50"
            >
              Send the first 10
            </button>
          )}
          <p className="text-center text-[12px] font-medium text-muted-foreground">
            {waiting > 10
              ? 'Sending a few first lets you check how the message lands before the rest go out.'
              : 'They’ll get it on WhatsApp.'}
          </p>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full text-center text-[12.5px] font-semibold text-muted-foreground underline"
      >
        {waiting > 0 ? 'I’ll send these later' : 'Close'}
      </button>
    </div>
  );
}

/**
 * One tenant the message did not reach, and the two ways to reach them now.
 *
 * "Share on WhatsApp" opens the owner's own WhatsApp with the tenant's number
 * and the link already written — the owner's number is one the tenant knows,
 * which is often exactly why this works where the automated message did not.
 */
function UndeliveredCard({ item }: { item: SendResult['undelivered'][number] }) {
  const [copied, setCopied] = useState(false);
  const text = buildActivationShareText(item.name, item.activation_link);

  return (
    <li className="rounded-xl border border-destructive/25 bg-destructive/5 p-3.5">
      <p className="font-display text-[13.5px] font-bold text-foreground">{item.name || 'This tenant'}</p>
      <p className="mt-0.5 text-[12px] font-medium text-muted-foreground">
        Didn’t reach them on WhatsApp. <span className="text-foreground/80">{item.reason}</span>
      </p>
      <div className="mt-2.5 flex gap-2">
        {item.phone && (
          <a
            href={buildWhatsAppShareUrl(item.phone, text)}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#1F8A5B] py-2 font-display text-[12.5px] font-bold text-white"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Share on WhatsApp
          </a>
        )}
        <button
          type="button"
          onClick={async () => setCopied(await copyActivationLink(item.activation_link))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 font-display text-[12.5px] font-bold text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </li>
  );
}
