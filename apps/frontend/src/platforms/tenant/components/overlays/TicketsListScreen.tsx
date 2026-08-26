import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Wrench, MessageSquareWarning } from 'lucide-react';
import type { ServiceRequest, ServiceRequestStatus } from '@features/tenant-room/api';
import { TONE_COLOR, type OverlayTone } from './types';

export type TicketBucket = 'track' | 'assigned' | 'completed';

const STATUS_LABEL: Record<ServiceRequestStatus, string> = {
  RAISED: 'Raised',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

const STATUS_TONE: Record<ServiceRequestStatus, OverlayTone> = {
  RAISED: 'yellow',
  ASSIGNED: 'orange',
  IN_PROGRESS: 'orange',
  RESOLVED: 'green',
  REJECTED: 'red',
};

/**
 * A ticket's lifecycle bucket for the 3-tab tracker: **Track** (just raised,
 * waiting to be picked up), **Assigned** (staff assigned / actively being
 * worked), **Completed** (resolved or rejected — cycle closed). Mirrors the
 * same RAISED→ASSIGNED→IN_PROGRESS→RESOLVED stages already used by
 * `serviceRequestDetailConfig.ts`'s stepper, just grouped for a list view.
 */
export function bucketForStatus(status: ServiceRequestStatus): TicketBucket {
  if (status === 'RESOLVED' || status === 'REJECTED') return 'completed';
  if (status === 'ASSIGNED' || status === 'IN_PROGRESS') return 'assigned';
  return 'track';
}

const TABS: Array<{ key: TicketBucket; label: string }> = [
  { key: 'track', label: 'Track' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'completed', label: 'Completed' },
];

const EMPTY_COPY: Record<TicketBucket, string> = {
  track: 'Nothing waiting on assignment right now.',
  assigned: 'Nothing currently has staff assigned.',
  completed: 'Nothing resolved yet.',
};

interface TicketsListScreenProps {
  requests: ServiceRequest[];
  onBack: () => void;
  onOpenTicket: (id: string) => void;
  onNewTicket: () => void;
}

/** Full-screen "My tickets" list — Track/Assigned/Completed tabs over every service request (any type), reachable from Room's ticket card and Profile's "View all activity". Same overlay chrome as `DetailScreen`. */
export function TicketsListScreen({ requests, onBack, onOpenTicket, onNewTicket }: TicketsListScreenProps) {
  const [tab, setTab] = useState<TicketBucket>('track');

  const counts = useMemo(() => {
    const c: Record<TicketBucket, number> = { track: 0, assigned: 0, completed: 0 };
    for (const r of requests) c[bucketForStatus(r.status)] += 1;
    return c;
  }, [requests]);

  const visible = useMemo(
    () => requests.filter((r) => bucketForStatus(r.status) === tab).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [requests, tab],
  );

  return (
    <div className="stayo-panel-slide-in fixed inset-0 z-[45] flex flex-col bg-background">
      <div className="flex flex-none items-center gap-3 border-b border-[#EEE4D8] px-[18px] pb-3 pt-14">
        <button type="button" onClick={onBack} className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border border-[#EFE6DA] bg-card">
          <ChevronLeft className="h-[18px] w-[18px] text-[#4A433C]" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-foreground">My complaints</div>
          <div className="text-[11.5px] font-medium text-[#8A7F75]">{requests.length} total</div>
        </div>
        <button
          type="button"
          onClick={onNewTicket}
          className="flex flex-none items-center gap-1.5 rounded-[11px] bg-foreground px-3 py-2 font-display text-[12px] font-bold text-background"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      <div className="flex-none px-[18px] pt-3.5">
        <div className="flex gap-1.5 rounded-[13px] border border-border bg-muted p-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-[9px] px-2.5 py-2 font-display text-[12.5px] font-bold transition-colors ${
                tab === t.key ? 'bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_rgba(164,93,68,0.55)]' : 'text-muted-foreground'
              }`}
            >
              {t.label}
              {counts[t.key] > 0 && <span className="ml-1.5 opacity-80">{counts[t.key]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-[18px] pb-7 pt-4">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
              <MessageSquareWarning className="h-5 w-5" />
            </span>
            <p className="max-w-[220px] text-[12.5px] text-muted-foreground">{EMPTY_COPY[tab]}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visible.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenTicket(r.id)}
                className="flex w-full items-center gap-3 rounded-[14px] border border-[#EFE6DA] bg-card px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04)]"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                  <Wrench className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-[#2A2521]">{r.category ?? r.type.replace('_', ' ')}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-[#9A8F84]">
                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {r.assigned_to ? ` · ${r.assigned_to}` : ''}
                  </div>
                </div>
                <span
                  className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                  style={{ background: TONE_COLOR[STATUS_TONE[r.status]].bg, color: TONE_COLOR[STATUS_TONE[r.status]].c }}
                >
                  {STATUS_LABEL[r.status]}
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
