import { useMemo, useState } from 'react';
import { TenantPageHeader } from '../components/TenantPageHeader';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Droplets, Wifi, Zap, Sparkles, Wrench, DoorOpen, KeyRound, UserPlus, BedDouble, ListChecks, MessageSquareWarning } from 'lucide-react';
import { useTenantRoom } from '@features/tenant-room/hooks/useTenantRoom';
import { tenantRoomService, type ServiceRequestType } from '@features/tenant-room/api';
import { useTenantProfile } from '@features/tenant-profile/hooks/useTenantProfile';
import { useOverlayStack } from '../components/overlays/useOverlayStack';
import { DetailScreen } from '../components/overlays/DetailScreen';
import { FormPanel } from '../components/overlays/FormPanel';
import { buildRoomDetailConfigs } from '../components/overlays/configs/roomDetailConfigs';
import { buildServiceRequestFormConfigs } from '../components/overlays/configs/serviceRequestFormConfigs';
import { buildServiceRequestDetailConfig } from '../components/overlays/configs/serviceRequestDetailConfig';
import { TicketsListScreen } from '../components/overlays/TicketsListScreen';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold uppercase tracking-wide text-muted-foreground';

const UTILITY_META: Record<string, { label: string; icon: typeof Wifi }> = {
  WATER: { label: 'Water supply', icon: Droplets },
  WIFI: { label: 'Wi-Fi', icon: Wifi },
  ELECTRICITY: { label: 'Electricity', icon: Zap },
  CLEANING: { label: 'Cleaning', icon: Sparkles },
};
const UTILITY_ORDER = ['WATER', 'WIFI', 'ELECTRICITY', 'CLEANING'];
const UTILITY_DETAIL_KEY: Record<string, string> = { WATER: 'water', WIFI: 'wifi', ELECTRICITY: 'electricity', CLEANING: 'cleaning' };
const STATUS_COLOR: Record<string, string> = { OK: 'bg-success', ISSUE: 'bg-warning', OUTAGE: 'bg-destructive' };
const STATUS_LABEL: Record<string, string> = { OK: 'Normal', ISSUE: 'Minor issue', OUTAGE: 'Outage' };

const TICKET_STEPS: Array<{ key: string; label: string }> = [
  { key: 'RAISED', label: 'Raised' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'RESOLVED', label: 'Resolved' },
];

const SERVICES: Array<{ type: ServiceRequestType; formKey: string; title: string; sub: string; icon: typeof Wrench }> = [
  { type: 'ROOM_CHANGE', formKey: 'svc_room_change', title: 'Room change', sub: 'Move room or bed', icon: DoorOpen },
  { type: 'CLEANING', formKey: 'svc_cleaning', title: 'Cleaning request', sub: 'Extra housekeeping', icon: Sparkles },
  { type: 'LOST_KEY', formKey: 'svc_lostkey', title: 'Lost key', sub: 'Report & replace', icon: KeyRound },
  { type: 'VISITOR_PASS', formKey: 'svc_visitor', title: 'Visitor pass', sub: 'Register a guest', icon: UserPlus },
  { type: 'EXTRA_MATTRESS', formKey: 'svc_mattress', title: 'Extra mattress', sub: 'Bedding request', icon: BedDouble },
  { type: 'MAINTENANCE', formKey: 'maint_new', title: 'Maintenance', sub: 'Report an issue', icon: Wrench },
];

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/** Tenant Room tab, per Stayo Tenant.dc.html. Drill-ins/forms use the shared overlay system (DetailScreen/FormPanel) rather than one-off screens — same architecture the design source itself uses. */
export function TenantRoomPage() {
  const navigate = useNavigate();
  const room = useTenantRoom();
  const profile = useTenantProfile();
  const overlay = useOverlayStack();
  const [openRuleSection, setOpenRuleSection] = useState<string | null>(null);

  const resolvedRequests = useMemo(() => room.requests.filter((r) => r.status === 'RESOLVED'), [room.requests]);

  const detailConfigs = useMemo(
    () => buildRoomDetailConfigs({ room: room.room, roommates: room.roommates, utilityStatus: room.utilityStatus, resolvedRequests, push: overlay.push }),
    [room.room, room.roommates, room.utilityStatus, resolvedRequests, overlay.push],
  );
  const formConfigs = useMemo(() => buildServiceRequestFormConfigs({ createRequest: room.createRequest }), [room.createRequest]);

  const ticketEventsQuery = useQuery({
    queryKey: ['tenant', 'service-requests', room.activeTicket?.id, 'events'],
    queryFn: () => tenantRoomService.getServiceRequestDetail(room.activeTicket!.id),
    enabled: overlay.view === 'maint_ticket' && Boolean(room.activeTicket),
  });

  /** Generic ticket detail, opened from the "view all tickets" list (any request, not just the inline `activeTicket`) — mirrors Profile's `tk_<id>` handling. */
  const genericTicketId = overlay.view.startsWith('tk_') ? overlay.view.slice(3) : null;
  const genericTicket = genericTicketId ? room.requests.find((r) => r.id === genericTicketId) ?? null : null;
  const genericTicketEventsQuery = useQuery({
    queryKey: ['tenant', 'service-requests', genericTicketId, 'events'],
    queryFn: () => tenantRoomService.getServiceRequestDetail(genericTicketId!),
    enabled: Boolean(genericTicketId && genericTicket),
  });

  if (room.isLoading) return <LoadingSkeleton />;

  const ticketStepIndex = room.activeTicket ? TICKET_STEPS.findIndex((s) => s.key === room.activeTicket!.status) : -1;
  const vacantBeds = Math.max((room.room?.capacity ?? 0) - room.roommates.length - 1, 0);

  return (
    <div className="min-h-screen">
      <TenantPageHeader title="My Room" subtitle="Everything about your living space" />
      <div className="flex flex-col gap-6 px-[22px] pb-8 pt-5">
        <button
          type="button"
          onClick={() => overlay.push('room_details')}
          className="relative overflow-hidden rounded-[20px] bg-foreground p-5 text-left text-background shadow-[0_10px_26px_rgba(34,30,26,0.18)]"
        >
          <div className="pointer-events-none absolute -right-9 -top-[30px] h-[140px] w-[140px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(217,144,111,0.22), transparent 70%)' }} />
          <div className="relative flex items-start gap-3.5">
            <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[14px] bg-primary font-display text-[20px] font-extrabold text-white shadow-[0_6px_14px_rgba(180,106,85,0.4)]">
              {room.room?.room_no ?? '—'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-white">Room {room.room?.room_no ?? '—'}</div>
              <div className="mt-0.5 text-[12px] font-medium text-[#B9AFA3]">{room.room?.floor ? `${room.room.floor} floor` : 'Your stay'}</div>
            </div>
            <span className="flex flex-none items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-[5px]">
              <span className="text-[10px] font-bold text-[#D8CFC5]">Details</span>
              <ChevronRight className="h-3 w-3 text-[#D8CFC5]" />
            </span>
          </div>
          <div className="relative mt-4 flex gap-2">
            {[
              { k: 'Sharing', v: room.room?.capacity ? `${room.room.capacity}-sharing` : '—' },
              { k: 'Roommates', v: String(room.roommates.length) },
              { k: 'Floor', v: room.room?.floor ?? '—' },
            ].map((c) => (
              <div key={c.k} className="flex-1 rounded-xl bg-white/[0.07] p-[10px_12px]">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#8C8177]">{c.k}</div>
                <div className="mt-0.5 font-display text-[13px] font-bold text-white">{c.v}</div>
              </div>
            ))}
          </div>
          {!room.hasOpenComplaint && (
            <div className="relative mt-3 flex items-center gap-2 rounded-xl bg-[rgba(127,191,155,0.13)] p-[11px_13px]">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#4FA97C]">
                <svg width="11" height="11" viewBox="0 0 11 11"><path d="M2 5.6 L4.4 8 L9 3" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="text-[12.5px] font-semibold text-[#CFE6D8]">Everything looks good — no issues right now</span>
            </div>
          )}
        </button>

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Living status</span>
          <div className={`${card} p-3.5`}>
            <div className="grid grid-cols-2 gap-2.5">
              {UTILITY_ORDER.map((key) => {
                const row = room.utilityStatus.find((u) => u.utility === key);
                const meta = UTILITY_META[key];
                const status = row?.status ?? 'OK';
                return (
                  <button key={key} type="button" onClick={() => overlay.push(UTILITY_DETAIL_KEY[key])} className="rounded-[13px] border border-[#EFE6DA] bg-background p-3 text-left">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white shadow-[0_1px_3px_rgba(40,30,20,0.06)]">
                      <meta.icon className="h-4 w-4 text-[#8A7F75]" />
                    </span>
                    <div className="mt-2.5 text-[12.5px] font-semibold text-[#2A2521]">{meta.label}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[status]}`} />
                      <span className="text-[11.5px] font-semibold text-[#8A7F75]">{STATUS_LABEL[status]}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {room.activeTicket && (
              <button type="button" onClick={() => overlay.push('maint_ticket')} className="mt-2.5 flex w-full items-center gap-2.5 rounded-[13px] border border-[#F1E2C4] bg-warning-bg p-[12px_13px] text-left">
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-white text-warning">
                  <Wrench className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-[#2A2521]">Active maintenance</div>
                  <div className="mt-0.5 text-[11px] font-medium text-[#9A8F84]">{room.activeTicket.category ?? 'Maintenance issue'} · {room.activeTicket.status.replace('_', ' ').toLowerCase()}</div>
                </div>
                <span className="flex-none rounded-full border border-[#F1E2C4] bg-white px-2.5 py-1 text-[10.5px] font-bold text-warning">1 active</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Roommates</span>
          <div className={`${card} divide-y divide-border px-4`}>
            <div className="flex items-center gap-3 py-3">
              <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-secondary font-display text-[14px] font-extrabold text-primary">S</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-foreground">You</div>
              </div>
              <span className="flex-none rounded-full bg-info-bg px-2.5 py-[3px] text-[10px] font-bold text-info">You</span>
            </div>
            {room.roommates.map((mate, i) => (
              <button key={i} type="button" onClick={() => overlay.push(`mate_${i}`)} className="flex w-full items-center gap-3 py-3 text-left">
                <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-secondary font-display text-[14px] font-extrabold text-primary">
                  {mate.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold text-foreground">{mate.name}</span>
                <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
              </button>
            ))}
            {Array.from({ length: vacantBeds }).map((_, i) => (
              <button key={`vacant-${i}`} type="button" onClick={() => overlay.push('vacant')} className="flex w-full items-center gap-3 py-3 text-left">
                <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full border-[1.5px] border-dashed border-[#D9CFC3] font-display text-[14px] font-extrabold text-[#B0A597]">+</span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold text-[#9A8F84]">Vacant bed</span>
                <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Room facilities</span>
          <div className={`${card} divide-y divide-border px-4`}>
            {[
              { key: 'wifi', name: 'Wi-Fi', meta: room.room?.wifi_name ? `${room.room.wifi_name}` : 'Ask the front desk', pill: 'Active', pillClass: 'bg-success-bg text-success' },
              { key: 'fac_hotwater', name: 'Hot water', meta: 'Attached bathroom', pill: '6–10 AM · 6–10 PM', pillClass: 'bg-warning-bg text-warning' },
              { key: 'fac_laundry', name: 'Laundry', meta: 'Shared · ground floor', pill: 'Available', pillClass: 'bg-success-bg text-success' },
              { key: 'fac_drinking', name: 'Drinking water', meta: 'RO purifier · corridor', pill: '24×7', pillClass: 'bg-success-bg text-success' },
              { key: 'fac_housekeeping', name: 'Housekeeping', meta: 'Room cleaning', pill: 'Daily', pillClass: 'bg-warning-bg text-warning' },
              { key: 'fac_bathroom', name: 'Attached bathroom', meta: 'Private to your room', pill: 'Private', pillClass: 'bg-info-bg text-info' },
            ].map((f) => (
              <button key={f.key} type="button" onClick={() => overlay.push(f.key)} className="flex w-full items-center gap-3 py-3 text-left">
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                  <Wifi className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-[#2A2521]">{f.name}</div>
                  <div className="mt-0.5 text-[11.5px] font-medium text-[#9A8F84]">{f.meta}</div>
                </div>
                <span className={`flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold ${f.pillClass}`}>{f.pill}</span>
              </button>
            ))}
          </div>
        </div>

        {room.activeTicket && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <span className={sectionLabel}>Tickets</span>
              {room.openRequests.length > 1 && (
                <button type="button" onClick={() => overlay.push('all_tickets')} className="text-[12px] font-semibold text-primary">
                  {room.openRequests.length} open · view all
                </button>
              )}
            </div>
            <div className={`${card} p-4`}>
              <button type="button" onClick={() => overlay.push('maint_ticket')} className="flex w-full items-start gap-2.5 text-left">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-foreground">{room.activeTicket.category ?? room.activeTicket.type.replace('_', ' ')}</div>
                  <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">Ticket · raised {new Date(room.activeTicket.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · tap to track</div>
                </div>
                <span className="flex-none rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-bold text-warning">{room.activeTicket.status.replace('_', ' ')}</span>
              </button>
              <div className="mt-4 flex items-center">
                {TICKET_STEPS.map((step, i) => (
                  <div key={step.key} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center gap-1">
                      <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-white ${i <= ticketStepIndex ? 'bg-primary' : 'bg-[#F0EAE2]'}`}>
                        {i <= ticketStepIndex && <span className="h-2 w-2 rounded-full bg-white" />}
                      </span>
                      <span className="whitespace-nowrap text-[9.5px] font-semibold text-muted-foreground">{step.label}</span>
                    </div>
                    {i < TICKET_STEPS.length - 1 && <div className={`mx-1.5 mb-[15px] h-0.5 flex-1 ${i < ticketStepIndex ? 'bg-primary' : 'bg-[#EAE1D8]'}`} />}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
                <button type="button" onClick={() => overlay.push('maint_history')} className="text-[12px] font-medium text-muted-foreground">
                  <b className="font-bold text-primary">{resolvedRequests.length} resolved</b> · view history
                </button>
                <button type="button" onClick={() => overlay.push('maint_new')} className="inline-flex items-center gap-1.5 rounded-[11px] bg-foreground px-3.5 py-2 font-display text-[12.5px] font-bold text-background">
                  New request
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Room services</span>
          <div className="grid grid-cols-2 gap-2.5">
            {SERVICES.map(({ formKey, title, sub, icon: Icon }) => (
              <button key={formKey} type="button" onClick={() => overlay.push(formKey)} className={`${card} flex flex-col gap-2.5 px-3.5 py-3.5 text-left`}>
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span>
                  <span className="block truncate text-[13px] font-semibold leading-tight text-[#2A2521]">{title}</span>
                  <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">{sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/tenant/complaints')}
          className={`${card} flex items-center gap-3 px-4 py-3.5 text-left`}
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
            <MessageSquareWarning className="h-4.5 w-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-[#2A2521]">Complaints</span>
            <span className="block text-[11px] text-muted-foreground">Raise a ticket, report a bug, or track what's open</span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
        </button>

        {room.houseRules.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>House rules</span>
            <div className="rounded-[16px] border border-[#EFE6DA] bg-[#FBF7F2] px-4">
              {room.houseRules.map((section, idx) => {
                const open = openRuleSection === section.title;
                return (
                  <div key={section.title} className={`py-3 ${idx > 0 ? 'border-t border-[#EFE6DA]' : ''}`}>
                    <button type="button" onClick={() => setOpenRuleSection(open ? null : section.title)} className="flex w-full items-center gap-3 text-left">
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] bg-[#F2E8DC] text-[#9C7A52]">
                        <ListChecks className="h-3.5 w-3.5" />
                      </span>
                      <span className="flex-1 text-[12.5px] font-semibold text-[#4A433C]">{section.title}</span>
                      <ChevronDown className={`h-3.5 w-3.5 flex-none text-[#B0A597] transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="stayo-accordion-reveal mt-2 flex flex-col gap-1 pl-10">
                        {section.items.map((item, i) => (
                          <div key={i} className="flex gap-2 py-0.5 text-[12px] leading-relaxed text-[#6E6459]">
                            <span className="text-primary">•</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="pt-0.5 text-center text-[11px] font-medium text-[#B7AC9F]">Stayo{profile.hostel?.name ? ` · ${profile.hostel.name}` : ''}</p>
      </div>

      {!overlay.isHome && overlay.view !== 'maint_ticket' && detailConfigs[overlay.view] && (
        <DetailScreen config={detailConfigs[overlay.view]} onBack={overlay.back} />
      )}
      {overlay.view === 'maint_ticket' && room.activeTicket && (
        <DetailScreen config={buildServiceRequestDetailConfig(room.activeTicket, ticketEventsQuery.data?.tenant_service_request_events ?? [])} onBack={overlay.back} />
      )}
      {overlay.view === 'all_tickets' && (
        <TicketsListScreen requests={room.requests} onBack={overlay.back} onOpenTicket={(id) => overlay.push(`tk_${id}`)} onNewTicket={() => overlay.push('maint_new')} />
      )}
      {genericTicketId && genericTicket && (
        <DetailScreen config={buildServiceRequestDetailConfig(genericTicket, genericTicketEventsQuery.data?.tenant_service_request_events ?? [])} onBack={overlay.back} />
      )}
      {!overlay.isHome && formConfigs[overlay.view] && (
        <FormPanel config={formConfigs[overlay.view]} onBack={overlay.back} onClose={overlay.close} />
      )}
    </div>
  );
}
