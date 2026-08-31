import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Mail, Share2 } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { playSuccessFeedback } from '@shared/ui-patterns/successFeedback';
import {
  buildActivationShareText,
  buildWhatsAppShareUrl,
  copyActivationLink,
  type InviteDeliveryOutcome,
} from './inviteDelivery';

interface InviteDeliveryResultProps {
  delivery: InviteDeliveryOutcome;
  tenantName: string;
  tenantPhone: string;
  onDone: () => void;
  /** Fallback-email prompt, shown when `delivery.needsEmail`. */
  fallbackEmail: string;
  setFallbackEmail: (value: string) => void;
  sendFallbackEmail: () => void;
  isSendingFallback: boolean;
  fallbackError: string | null;
  canSendFallback: boolean;
}

const primaryBtn =
  'w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50';
const secondaryBtn =
  'flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-3 font-display text-[13px] font-bold text-foreground';

/**
 * What the owner sees after sending an invitation — the truth about whether it
 * was delivered, and a way out when it wasn't.
 *
 * This replaced an unconditional "Invitation sent! {name} will get a text to
 * complete KYC." that rendered on every 2xx, including the 202 the backend
 * returns when nothing was delivered at all. Three cases now, and the
 * activation link is always offered in the failure ones so the owner can still
 * onboard the tenant by hand rather than being stranded.
 *
 * The delivered case is a plain confirmation, not a choice. It used to also
 * offer "Wait for them to activate" vs. "Keep the records myself meanwhile" —
 * that fork is gone because there is nothing left to decide: the tenancy is
 * already live and owner-managed by the time this screen renders (the
 * backend does that inside the same transaction that creates the invitation
 * — see `tenant-invitation-lifecycle-service.ts`'s `createInvitation`), so
 * "keep the records myself" was already true before the owner could click
 * anything.
 */
export function InviteDeliveryResult({
  delivery,
  tenantName,
  tenantPhone,
  onDone,
  fallbackEmail,
  setFallbackEmail,
  sendFallbackEmail,
  isSendingFallback,
  fallbackError,
  canSendFallback,
}: InviteDeliveryResultProps) {
  const [copied, setCopied] = useState(false);

  /*
   * Only when something actually reached the tenant. `channel === 'none'`
   * renders the warning branch below: the tenant exists, but neither
   * WhatsApp nor email got through and the owner has to deliver the link
   * themselves. A triumph sound over that screen would be telling them the
   * opposite of what it says.
   */
  const delivered = delivery.channel !== 'none';
  useEffect(() => {
    if (delivered) playSuccessFeedback();
  }, [delivered]);
  const name = tenantName.trim() || 'The tenant';

  const handleCopy = async () => {
    const ok = await copyActivationLink(delivery.activationLink);
    setCopied(ok);
    if (ok) stayoToast.success('Activation link copied');
    // A blocked clipboard (insecure origin, denied permission) isn't a dead
    // end — the link is on screen and selectable either way.
    else stayoToast.error('Could not copy. Select the link above and copy it manually.');
  };

  const handleShare = () => {
    if (!delivery.activationLink) return;
    const text = buildActivationShareText(tenantName, delivery.activationLink);
    window.open(buildWhatsAppShareUrl(tenantPhone, text), '_blank', 'noopener,noreferrer');
  };

  if (delivery.channel === 'whatsapp' || delivery.channel === 'email') {
    const viaEmail = delivery.channel === 'email';
    return (
      <div className="flex flex-col items-center gap-3.5 py-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
          <Check className="h-7 w-7 text-success" strokeWidth={3} />
        </span>
        <p className="font-display text-lg font-extrabold text-foreground">
          {viaEmail ? 'Invitation sent by email' : 'Invitation sent successfully'}
        </p>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {viaEmail ? (
            <>
              WhatsApp couldn&apos;t reach {name}, so we emailed the invite
              {delivery.sentTo ? <> to <b className="font-semibold text-foreground">{delivery.sentTo}</b></> : null}.
            </>
          ) : (
            <>
              {name} has been sent a WhatsApp message
              {delivery.sentTo ? <> on <b className="font-semibold text-foreground">{delivery.sentTo}</b></> : null} to
              complete KYC.
            </>
          )}
        </p>
        <div className="mt-2 flex w-full flex-col items-center gap-2">
          <button type="button" onClick={onDone} className={primaryBtn}>
            Done
          </button>
          <p className="max-w-[280px] text-center text-[11.5px] leading-snug text-muted-foreground">
            You keep the books and rent starts today. If {name} activates later, they&apos;ll pick up this exact
            record — nothing is duplicated.
          </p>
        </div>
      </div>
    );
  }

  // Case C — nothing was delivered. The tenant record and their room hold
  // exist; only the message failed. Say so, and hand over the link.
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
          <AlertTriangle className="h-6 w-6 text-warning" strokeWidth={2.2} />
        </span>
        <p className="font-display text-[17px] font-extrabold text-foreground">Invitation could not be delivered</p>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {name}&apos;s room is held and their account is created — but the invite message didn&apos;t reach them.
          {delivery.reason ? <> Reason: <span className="font-semibold text-foreground">{delivery.reason}</span></> : null}
        </p>
      </div>

      {delivery.needsEmail && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-muted/50 p-3.5">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" strokeWidth={1.9} />
            <span className="font-display text-[13.5px] font-bold text-foreground">Try email instead</span>
          </div>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            No email address on file for {name}. Add one and we&apos;ll send the same invitation — no need to start over.
          </p>
          <input
            value={fallbackEmail}
            onChange={(e) => setFallbackEmail(e.target.value)}
            placeholder="tenant@example.com"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
          />
          {fallbackError && <p className="text-[11.5px] font-semibold text-destructive">{fallbackError}</p>}
          <button
            type="button"
            onClick={sendFallbackEmail}
            disabled={!canSendFallback || isSendingFallback}
            className={primaryBtn}
          >
            {isSendingFallback ? 'Sending…' : 'Send email invitation'}
          </button>
        </div>
      )}

      {delivery.activationLink && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3.5">
          <span className="font-display text-[13.5px] font-bold text-foreground">Send the link yourself</span>
          <p className="break-all rounded-[10px] bg-muted px-3 py-2.5 text-[11.5px] text-muted-foreground">
            {delivery.activationLink}
          </p>
          <div className="flex gap-2.5">
            <button type="button" onClick={handleCopy} className={secondaryBtn}>
              {copied ? <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.4} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" onClick={handleShare} className={secondaryBtn}>
              <Share2 className="h-3.5 w-3.5" strokeWidth={1.9} />
              Share link
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={onDone} className="text-center font-display text-[13px] font-bold text-muted-foreground">
        Close
      </button>
    </div>
  );
}
