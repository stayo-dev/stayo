import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, LifeBuoy, MessageSquareWarning, Plus } from 'lucide-react';
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
 * Tenant → owner/hostel complaint hub. No longer a primary nav tab (the
 * single-level active-tenant nav is Home/Payments/Food/Room/Profile/Explore
 * — see `ACTIVE_TENANT_TABS`) — reached contextually from Room instead, as a
 * full-screen takeover with its own back button, same "outside the shell"
 * pattern as `/tenant/move-out`. Deliberately kept separate from the
 * Stayo-Admin-bound Profile → "Raise a Ticket" system (ADR-079) — this page
 * still only ever writes to `tenant_service_requests`, unchanged.
 *
 * **The "Report a bug" button used to live here and was a wrong-inbox bug of
 * its own.** Its copy said "Help us improve the app" and "our team will
 * investigate", but it wrote a `MAINTENANCE` row to `tenant_service_requests`
 * — so a tenant reporting a Stayo payments bug filed a maintenance job with
 * their *hostel owner*, who could do nothing about it. Five of the nine live
 * rows arrived this way, categorised "Payments", "Food ordering" and "Room
 * services". Both the button and its form config are gone; app problems go to
 * the Help Centre, which is the Stayo inbox ([[ADR-117]]).
 *
 * One page, one action, one vocabulary: a resident raises **complaints** with
 * their hostel and sends **reports** to Stayo. The word "ticket" — inherited
 * from the old `TenantProfilePage`'s "Tickets & bug reports" section — meant
 * both and so distinguished neither.
 */
export function TenantComplaintsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const room = useTenantRoom();
  const overlay = useOverlayStack();

  const formConfigs = useMemo(() => buildServiceRequestFormConfigs({ createRequest: room.createRequest }), [room.createRequest]);

  // Deep link from a tapped notification (`/tenant/notifications` navigates
  // here with `state: { openTicketId }`) — open that ticket's detail once on
  // mount, then clear the state so a later back-navigation doesn't reopen it.
  useEffect(() => {
    const requestId = (location.state as { openTicketId?: string } | null)?.openTicketId;
    if (requestId) {
      overlay.push(`tk_${requestId}`);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, reads location.state once
  }, []);

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
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate('/tenant/room')}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>
          <div>
            <h1 className="font-display text-[24px] font-extrabold tracking-[-0.03em] text-foreground">Complaints</h1>
            <p className="mt-0.5 text-[12px] font-medium text-muted-foreground">Tell your hostel what needs fixing, and follow it here</p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Your complaints</span>
            {openTickets.length > 0 && <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[10px] font-bold text-warning">{openTickets.length} open</span>}
          </div>
          <div className={`${card} p-4`}>
            <button
              type="button"
              onClick={() => overlay.push('raise_ticket')}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] px-4 py-3.5 text-white shadow-[0_8px_18px_rgba(164,93,68,0.24)]"
              style={{ background: 'linear-gradient(135deg, #B46A55, #C97E5F)' }}
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />
              <span className="font-display text-[13px] font-bold">Raise a complaint</span>
            </button>
            {room.requests.length > 0 && (
              <>
                <div className="mt-1 divide-y divide-[#F2ECE5]">
                  {room.requests.slice(0, 5).map((t) => (
                    <button key={t.id} type="button" onClick={() => overlay.push(`tk_${t.id}`)} className="flex w-full items-center gap-3 py-3.5 text-left">
                      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                        <MessageSquareWarning className="h-4 w-4" />
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

        {/*
          The door to the other inbox, kept plainly separate rather than sitting
          beside "Raise a complaint" as an equal choice — which is what let five
          real app bugs be filed against a hostel owner who could not fix them.
        */}
        <button
          type="button"
          onClick={() => navigate('/profile/tickets')}
          className={`${card} flex items-center gap-3 p-4 text-left`}
        >
          <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-[#F5E9E3] text-primary">
            <LifeBuoy className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-foreground">Something wrong with the app?</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
              Payments, login, a screen that won&rsquo;t load — that one is Stayo&rsquo;s to fix, not your hostel&rsquo;s
            </div>
          </div>
        </button>
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
