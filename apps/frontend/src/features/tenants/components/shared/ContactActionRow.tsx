import { Phone, MessageCircle, Copy, Clock } from 'lucide-react';

interface ContactActionRowProps {
  label: string;
  name?: string;
  relation?: string;
  phone: string;
  onCall: (phone: string) => void;
  onWhatsApp: (phone: string) => void;
  onCopy: (phone: string) => void;
  onHistory?: () => void;
}

export function ContactActionRow({
  label,
  name,
  relation,
  phone,
  onCall,
  onWhatsApp,
  onCopy,
  onHistory,
}: ContactActionRowProps) {
  if (!phone) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border bg-card hover:bg-accent/5 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {relation && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
              {relation}
            </span>
          )}
        </div>
        {name && <p className="font-medium text-foreground mt-0.5">{name}</p>}
        <p className="text-sm text-muted-foreground font-mono mt-0.5">{phone}</p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
        <button
          type="button"
          onClick={() => onCall(phone)}
          className="p-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all"
          title={`Call ${name || label}`}
        >
          <Phone className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onWhatsApp(phone)}
          className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 active:scale-95 transition-all"
          title={`WhatsApp ${name || label}`}
        >
          <MessageCircle className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onCopy(phone)}
          className="p-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all"
          title="Copy phone number"
        >
          <Copy className="w-4 h-4" />
        </button>
        {onHistory && (
          <button
            type="button"
            onClick={onHistory}
            className="p-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all"
            title="Communication history"
          >
            <Clock className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
