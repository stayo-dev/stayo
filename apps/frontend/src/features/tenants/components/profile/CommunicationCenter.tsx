import { useState } from 'react';
import {
  Phone,
  MessageCircle,
  Copy,
  History as HistoryIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTenantActions } from '@features/tenants/hooks/useTenantActions';
import { toast } from 'sonner';

interface ContactRowProps {
  label: string;
  name: string;
  relation?: string;
  phone: string;
  history?: Array<{ event: string; date: string }>;
}

function ContactRow({ label, name, relation, phone, history = [] }: ContactRowProps) {
  const actions = useTenantActions('');
  const [showHistory, setShowHistory] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(phone);
    toast.success(`${label} phone number copied to clipboard`);
  };

  return (
    <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
            {label} {relation ? `(${relation})` : ''}
          </span>
          <span className="text-sm font-semibold text-foreground mt-0.5">{name}</span>
          <span className="text-xs text-muted-foreground">{phone}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => actions.callTenant(phone)}
            className="p-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0"
            title="Call"
          >
            <Phone className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => actions.whatsAppTenant(phone)}
            className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/30 active:scale-95 transition-all shrink-0"
            title="WhatsApp"
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={copyToClipboard}
            className="p-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0"
            title="Copy Number"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-lg transition-all shrink-0 flex items-center justify-center ${
                showHistory
                  ? 'bg-accent/15 text-accent'
                  : 'bg-secondary text-foreground hover:bg-secondary/80 active:scale-95'
              }`}
              title="Communication History"
            >
              <HistoryIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {showHistory && history.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-1.5 animate-in slide-in-from-top-1 duration-150">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block">
            Recent Contact History
          </span>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex justify-between text-[11px] text-muted-foreground py-0.5">
                <span>{h.event}</span>
                <span className="font-medium text-foreground">{h.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface CommunicationCenterProps {
  tenantName: string;
  tenantPhone: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelation?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  emergencyRelation?: string;
  timelineItems?: any[];
}

export function CommunicationCenter({
  tenantName,
  tenantPhone,
  guardianName,
  guardianPhone,
  guardianRelation,
  emergencyName,
  emergencyPhone,
  emergencyRelation,
  timelineItems = [],
}: CommunicationCenterProps) {
  // Infer tenant communication history from timeline items (reminders, calls, whatsapp)
  const getTenantHistory = () => {
    const history: Array<{ event: string; date: string }> = [];
    
    // Sort and limit items
    const relevant = timelineItems
      .filter(item => {
        const title = String(item.title ?? '').toLowerCase();
        const subtitle = String(item.subtitle ?? '').toLowerCase();
        return (
          title.includes('reminder') ||
          title.includes('call') ||
          title.includes('whatsapp') ||
          subtitle.includes('reminder') ||
          subtitle.includes('call') ||
          subtitle.includes('whatsapp')
        );
      })
      .slice(0, 3);

    relevant.forEach(item => {
      const dateStr = item.date instanceof Date 
        ? item.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
        : new Date(String(item.date)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      history.push({
        event: item.title || 'Reminder Sent',
        date: dateStr,
      });
    });

    if (history.length === 0) {
      history.push({ event: 'No communication history recorded', date: '—' });
    }

    return history;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Communication Center</h3>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Tenant contact */}
        <ContactRow
          label="Tenant"
          name={tenantName}
          phone={tenantPhone}
          history={getTenantHistory()}
        />

        {/* Guardian contact */}
        {guardianPhone && (
          <ContactRow
            label="Guardian"
            name={guardianName || 'Guardian'}
            relation={guardianRelation || 'Parent'}
            phone={guardianPhone}
            history={[
              { event: 'Emergency contact verified', date: 'Onboarding' }
            ]}
          />
        )}

        {/* Emergency contact */}
        {emergencyPhone && (
          <ContactRow
            label="Emergency Contact"
            name={emergencyName || 'Emergency'}
            relation={emergencyRelation}
            phone={emergencyPhone}
            history={[
              { event: 'Added as secondary emergency contact', date: 'Onboarding' }
            ]}
          />
        )}
      </div>
    </div>
  );
}
