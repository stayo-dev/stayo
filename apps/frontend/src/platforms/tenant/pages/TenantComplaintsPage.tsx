import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bug, MessageSquareWarning } from 'lucide-react';
import { useTenantRoom } from '@features/tenant-room/hooks/useTenantRoom';
import { tenantRoomService } from '@features/tenant-room/api';
import { useOverlayStack } from '../components/overlays/useOverlayStack';
import { DetailScreen } from '../components/overlays/DetailScreen';
import { FormPanel } from '../components/overlays/FormPanel';
import { buildServiceRequestFormConfigs } from '../components/overlays/configs/serviceRequestFormConfigs';
import { buildServiceRequestDetailConfig } from '../components/overlays/configs/serviceRequestDetailConfig';
import { TicketsListScreen } from '../components/overlays/TicketsListScreen';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold uppercase tracking-wide text-muted-foreground';

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/**
 * Dashboard's Complaints tab (ADR-078 supersedes ADR-068's "no Complaints
 * tab" call — new explicit product direction). Ticket UI/copy carried over
 * from the old `TenantProfilePage`'s "Tickets & bug reports" section
 * (deleted as part of the same change, dissolved into the shared Profile
 * hub and here) rather than rebuilt — same `tenant_service_requests` data
 * via `useTenantRoom()`, same overlay system Room's own service-request
 * tiles already use (`buildServiceRequestFormConfigs` produces both sets of
 * keys from one function; Room's tiles are unaffected).
 */
export function TenantComplaintsPage() {
  const room = useTenantRoom();
  const overlay = useOverlayStack();

  const formConfigs = useMemo(() => buildServiceRequestFormConfigs({ createRequest: room.createRequest }), [room.createRequest]);

  const activeTicketId = overlay.view.startsWith('tk_') ? overlay.view.slice(3) : null;
  const activeTicket = activeTicketId ? room.requests.find((r) => r.id === activeTicketId) ?? null : null;
  const ticketEventsQuery = useQuery({
    queryKey: ['tenant', 'service-requests', activeTicketId, 'events'],
    queryFn: () => tenantRoomService.getServiceRequestDetail(activeTicketId!),
    enabled: Boolean(activeTicketId && activeTicket),
  });

  if (room.isLoading) return <LoadingSkeleton />;

  const openTickets = room.requests.filter((r) => r.status !== 'RESOLVED' && r.status !== 'REJECTED');

  return (
    <div className="min-h-screen">
      <div className="flex flex-col gap-6 px-[22px] pb-8 pt-6">
        <div>
          <h1 className="font-display text-[24px] font-extrabold tracking-[-0.03em] text-foreground">Complaints</h1>
          <p className="mt-0.5 text-[12px] font-medium text-muted-foreground">Raise a ticket, report a bug, or track what's open</p>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Tickets &amp; bug reports</span>
            {openTickets.length > 0 && <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[10px] font-bold text-warning">{openTickets.length} open</span>}
          </div>
          <div className={`${card} p-4`}>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => overlay.push('raise_ticket')}
                className="flex flex-1 flex-col items-center gap-2 rounded-[14px] p-[15px_10px] text-white shadow-[0_8px_18px_rgba(164,93,68,0.24)]"
                style={{ background: 'linear-gradient(135deg, #B46A55, #C97E5F)' }}
              >
                <MessageSquareWarning className="h-[21px] w-[21px]" strokeWidth={1.9} />
                <span className="font-display text-[12.5px] font-bold">Raise a ticket</span>
              </button>
              <button type="button" onClick={() => overlay.push('report_bug')} className="flex flex-1 flex-col items-center gap-2 rounded-[14px] border border-[#F0E7DC] bg-[#F8F2EC] p-[15px_10px] text-[#8A5A48]">
                <Bug className="h-5 w-5 text-primary" strokeWidth={1.8} />
                <span className="font-display text-[12.5px] font-bold">Report a bug</span>
              </button>
            </div>
            {room.requests.length > 0 && (
              <>
                <div className="mt-1 divide-y divide-[#F2ECE5]">
                  {room.requests.slice(0, 5).map((t) => (
                    <button key={t.id} type="button" onClick={() => overlay.push(`tk_${t.id}`)} className="flex w-full items-center gap-3 py-3.5 text-left">
                      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                        {t.category?.toLowerCase().includes('bug') ? <Bug className="h-4 w-4" /> : <MessageSquareWarning className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[#2A2521]">{t.category ?? t.type.replace('_', ' ')}</div>
                        <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                      </div>
                      <span className="flex-none rounded-full bg-warning-bg px-2.5 py-1 text-[10px] font-bold text-warning">{t.status.replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => overlay.push('all_tickets')}
                  className="mt-1 w-full border-t border-[#F2ECE5] pt-3.5 text-center font-display text-[12.5px] font-bold text-primary"
                >
                  View all activity
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {activeTicket && (
        <DetailScreen config={buildServiceRequestDetailConfig(activeTicket, ticketEventsQuery.data?.tenant_service_request_events ?? [])} onBack={overlay.back} />
      )}
      {overlay.view === 'all_tickets' && (
        <TicketsListScreen requests={room.requests} onBack={overlay.back} onOpenTicket={(id) => overlay.push(`tk_${id}`)} onNewTicket={() => overlay.push('raise_ticket')} />
      )}
      {!overlay.isHome && !activeTicketId && formConfigs[overlay.view] && (
        <FormPanel config={formConfigs[overlay.view]} onBack={overlay.back} onClose={overlay.close} />
      )}
    </div>
  );
}
