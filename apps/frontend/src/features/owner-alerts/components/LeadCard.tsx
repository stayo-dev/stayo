import { MessageCircle } from 'lucide-react';
import { openWhatsAppShare } from '@lib/share';
import { rowCard, actionBtn, leadSideBtn, initials, soon } from '../alertsStyles';
import { LEAD_SOURCE_LABEL, leadStatusLabel, leadStatusToneClass } from '../leadConstants';
import { PRIMARY_ACTION_LABEL, type LeadPrimaryAction } from '../leadInbox';
import type { DynamicLead } from '../hooks/useAlerts';

/**
 * One enquiry.
 *
 * The dark primary button is whatever that lead's **next step** actually is —
 * "Accept & invite" while it is undecided, "Send invitation" once it has been
 * accepted but nobody has been invited, "Review" while it is on hold. A lead
 * with nothing outstanding gets no primary button at all.
 *
 * That is the change from the old card, which put WhatsApp in the dark
 * position on every lead including settled ones, so the most prominent thing
 * on a finished enquiry was a conversation there was no longer any reason to
 * start. Call and WhatsApp stay, as the quieter pair they are.
 */
export function LeadCard({
  lead,
  action,
  onOpen,
  onPrimary,
}: {
  lead: DynamicLead;
  action: LeadPrimaryAction;
  onOpen: () => void;
  onPrimary: () => void;
}) {
  const phone = lead.student_phone;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      className={`${rowCard} cursor-pointer`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-secondary font-display text-xs font-bold text-primary">
          {initials(lead.student_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-foreground">{lead.student_name}</div>
          <div className="text-[11.5px] text-muted-foreground">
            Enquired via {LEAD_SOURCE_LABEL[lead.source] ?? lead.source}
            {lead.hostel?.name ? ` · ${lead.hostel.name}` : ''}
          </div>
        </div>
        <span className={`flex-none rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${leadStatusToneClass(lead.status)}`}>
          {leadStatusLabel(lead.status)}
        </span>
      </div>

      <div className={`flex items-center gap-2 ${action ? '' : '[&>*]:flex-1'}`}>
        {phone ? (
          <a href={`tel:${phone}`} onClick={stop} className={leadSideBtn}>
            Call
          </a>
        ) : (
          <button type="button" onClick={(e) => { stop(e); soon(); }} className={leadSideBtn}>
            Call
          </button>
        )}

        {phone ? (
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              openWhatsAppShare(
                `Hi ${lead.student_name}, this is regarding your enquiry at ${lead.hostel?.name ?? 'our hostel'}.`,
                phone ?? undefined,
              );
            }}
            aria-label={`WhatsApp ${lead.student_name}`}
            className={leadSideBtn}
          >
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
            Chat
          </button>
        ) : (
          <button type="button" onClick={(e) => { stop(e); soon(); }} className={leadSideBtn}>
            Chat
          </button>
        )}

        {action && (
          <button
            type="button"
            onClick={(e) => { stop(e); onPrimary(); }}
            className={actionBtn}
          >
            {PRIMARY_ACTION_LABEL[action]}
          </button>
        )}
      </div>
    </div>
  );
}
