import { useState } from 'react';
import { Bell, Check, MessageCircle, Phone } from 'lucide-react';
import { phoneDigits, whatsAppNumber } from '@features/owner-search/searchActions';
import { useSendReminder } from '@features/notifications/useSendReminder';

/**
 * Reach this tenant, from wherever they are listed.
 *
 * Reminders already go out automatically; this is the owner's own nudge —
 * "I know this person, I want to ring them now" — which previously meant
 * opening the tenant, finding the number and leaving the app. Contact belongs
 * next to the person, not two screens away.
 *
 * Only what applies is shown: no number, no call or WhatsApp; nothing owed,
 * no reminder. An action that cannot do anything useful is worse than a
 * missing one, because it still has to be read.
 */

interface TenantQuickActionsProps {
  tenantId: string;
  name: string;
  phone?: string | null;
  /** Reminding someone who owes nothing is noise, so the nudge is hidden then. */
  outstanding: number;
}

const chip =
  'inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 text-[12px] font-semibold text-foreground active:scale-[0.98] transition-transform';

export function TenantQuickActions({ tenantId, name, phone, outstanding }: TenantQuickActionsProps) {
  const [justSent, setJustSent] = useState(false);
  const reminder = useSendReminder(tenantId, { onSent: () => setJustSent(true) });

  const digits = phoneDigits(phone);
  const whatsApp = whatsAppNumber(phone);
  const canRemind = outstanding > 0;
  if (!digits && !whatsApp && !canRemind) return null;

  return (
    // Plain div, not a button: this sits inside a card whose body is already a
    // button, and a button cannot contain another button.
    <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
      {digits && (
        <a href={`tel:${digits}`} className={chip} aria-label={`Call ${name}`} onClick={(e) => e.stopPropagation()}>
          <Phone className="h-3.5 w-3.5" strokeWidth={2.2} />
          Call
        </a>
      )}
      {whatsApp && (
        <a
          href={`https://wa.me/${whatsApp}`}
          target="_blank"
          rel="noopener noreferrer"
          className={chip}
          aria-label={`WhatsApp ${name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
          WhatsApp
        </a>
      )}
      {canRemind && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            reminder.mutate();
          }}
          // Stays disabled after a send: the second tap of a "remind" button is
          // almost always an accident, and it costs the tenant a second message.
          disabled={reminder.isPending || justSent}
          className={`${chip} disabled:opacity-60`}
          aria-label={`Send ${name} a payment reminder`}
        >
          {justSent ? <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.6} /> : <Bell className="h-3.5 w-3.5" strokeWidth={2.2} />}
          {reminder.isPending ? 'Sending…' : justSent ? 'Reminded' : 'Remind'}
        </button>
      )}
    </div>
  );
}
