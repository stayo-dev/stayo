import { useState } from 'react';
import { Phone, MessageCircle, Copy, History, BadgeCheck, ChevronDown } from 'lucide-react';
import { useTenantActions } from '@features/tenants/hooks/useTenantActions';
import { toContactRows, type ContactChannel, type ContactRow } from './contactChannels';

/**
 * The Communication Center, as something an owner can actually use.
 *
 * The previous version rendered four `<span>` elements per contact — no
 * handlers, no `aria-label`, one icon (a document) that mapped to no action at
 * all — while a wired equivalent sat in a tenant-profile tree nothing imported.
 * Every control here performs a real action, and a control is rendered only
 * when `contactChannels` says the row has the data to back it.
 */

interface CommunicationCardProps {
  /** The raw owner-overview response; `toContactRows` reads the phone columns from it. */
  overview: Record<string, any>;
  hostelId: string;
  /** Reminder/contact history, already narrowed to this tenant. */
  history: Array<{ id: string; title: string; date: string }>;
}

const CHANNEL_STYLES: Record<ContactChannel, string> = {
  call: 'bg-muted text-foreground hover:bg-secondary',
  whatsapp: 'bg-success/10 text-success hover:bg-success/15',
  copy: 'bg-muted text-foreground hover:bg-secondary',
};

const CHANNEL_ICONS: Record<ContactChannel, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  copy: Copy,
};

const CHANNEL_LABELS: Record<ContactChannel, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  copy: 'Copy number',
};

function ContactCard({
  row,
  hostelId,
  history,
}: {
  row: ContactRow;
  hostelId: string;
  history: CommunicationCardProps['history'];
}) {
  const actions = useTenantActions(hostelId);
  const [historyOpen, setHistoryOpen] = useState(false);

  // History is only meaningful for the tenant's own number — reminders are
  // sent to the tenant, never to a guardian or emergency contact.
  const canShowHistory = row.kind === 'tenant' && history.length > 0;

  const run = (channel: ContactChannel) => {
    if (channel === 'call') return actions.callTenant(row.phone);
    if (channel === 'whatsapp') return actions.whatsAppTenant(row.phone);
    return actions.copyPhone(row.phone);
  };

  return (
    <div className="rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
            {row.label}
            {row.relation ? ` (${row.relation})` : ''}
          </div>
          <div className="mt-0.5 font-display text-[13.5px] font-bold text-foreground">{row.name}</div>
          <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            {row.phone || 'No number on file'}
            {row.verified && (
              <BadgeCheck className="h-3.5 w-3.5 text-success" strokeWidth={2} aria-label="Number verified" />
            )}
          </div>
        </div>

        <div className="flex flex-none gap-1.5">
          {row.channels.map((channel) => {
            const Icon = CHANNEL_ICONS[channel];
            return (
              <button
                key={channel}
                type="button"
                onClick={() => run(channel)}
                aria-label={`${CHANNEL_LABELS[channel]} ${row.name}`}
                title={CHANNEL_LABELS[channel]}
                className={`flex h-8.5 w-8.5 items-center justify-center rounded-full transition-colors active:scale-95 ${CHANNEL_STYLES[channel]}`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            );
          })}
          {canShowHistory && (
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-label="Contact history"
              aria-expanded={historyOpen}
              title="Contact history"
              className={`flex h-8.5 w-8.5 items-center justify-center rounded-full transition-colors active:scale-95 ${
                historyOpen ? 'bg-primary/12 text-primary' : 'bg-muted text-foreground hover:bg-secondary'
              }`}
            >
              <History className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>

      {historyOpen && canShowHistory && (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <ChevronDown className="h-3 w-3" strokeWidth={2.2} />
            Recent contact
          </div>
          <ul className="flex flex-col gap-1">
            {history.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.title}</span>
                <span className="flex-none font-semibold text-foreground">{item.date}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CommunicationCard({ overview, hostelId, history }: CommunicationCardProps) {
  const rows = toContactRows(overview);

  return (
    <section>
      <h2 className="mb-2.5 px-0.5 font-display text-[15px] font-bold text-foreground">
        Communication Center
      </h2>
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <ContactCard key={row.kind} row={row} hostelId={hostelId} history={history} />
        ))}
      </div>
    </section>
  );
}
