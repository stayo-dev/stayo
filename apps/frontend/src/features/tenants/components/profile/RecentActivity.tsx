import {
  CalendarDays,
  CircleDollarSign,
  Bell,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  Shield,
  Clock,
} from 'lucide-react';

interface RecentActivityProps {
  events: Array<{
    id: string;
    date: Date | string;
    title: string;
    subtitle: string;
    type?: string;
  }>;
  onViewAll?: () => void;
}

export function RecentActivity({ events, onViewAll }: RecentActivityProps) {
  const getIcon = (title: string, subtitle: string) => {
    const text = (title + ' ' + subtitle).toLowerCase();
    if (text.includes('paid') || text.includes('payment') || text.includes('collected')) {
      return <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
    }
    if (text.includes('reminder') || text.includes('remind')) {
      return <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
    }
    if (text.includes('whatsapp') || text.includes('message') || text.includes('note')) {
      return <MessageSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />;
    }
    return <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const formatDate = (dateInput: Date | string) => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  // Take the most recent 3 events
  const displayedEvents = events.slice(0, 3);

  return (
    <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
          <Clock className="w-4 h-4 text-accent" />
          <span>Recent Activity</span>
        </div>
        {onViewAll && events.length > 3 && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-xs font-semibold text-accent hover:underline flex items-center gap-0.5"
          >
            <span>View All</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="relative border-l border-border/80 pl-4 ml-2.5 space-y-4">
        {displayedEvents.map((event) => (
          <div key={event.id} className="relative group">
            {/* Timeline dot */}
            <span className="absolute -left-[24px] top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-colors group-hover:border-accent/40">
              {getIcon(event.title, event.subtitle)}
            </span>

            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-foreground block">
                  {event.title}
                </span>
                <span className="text-[11px] text-muted-foreground block mt-0.5 leading-relaxed">
                  {event.subtitle}
                </span>
              </div>
              <span className="text-[10px] font-medium text-muted-foreground shrink-0 mt-0.5">
                {formatDate(event.date)}
              </span>
            </div>
          </div>
        ))}

        {displayedEvents.length === 0 && (
          <div className="text-xs text-muted-foreground py-2 text-center -ml-4">
            No recent activity logged.
          </div>
        )}
      </div>
    </div>
  );
}
