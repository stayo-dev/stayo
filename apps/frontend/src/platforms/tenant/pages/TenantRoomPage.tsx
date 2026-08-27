import { useMemo, useState } from 'react';
import { TenantPageHeader } from '../components/TenantPageHeader';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Droplets, Wifi, Zap, Sparkles, Wrench, DoorOpen, KeyRound, UserPlus, BedDouble, ListChecks, MessageSquareWarning, Flame, Shirt, ShowerHead, UtensilsCrossed, Car, ShieldCheck, CircleDot, LogOut, Repeat } from 'lucide-react';
import { useTenantRoom } from '@features/tenant-room/hooks/useTenantRoom';
import { buildTenantFacilities, type FacilityIcon } from '@features/tenant-room/facilities';
import ShareSheet from '@shared/ui-patterns/ShareSheet';
import { MoveOutSheet } from '@features/tenant-room/components/MoveOutSheet';
import { buildShareUrl } from '@shared/lib/shareListing';
import { copyToClipboard } from '@lib/share';
import { useShareHostel } from '@shared/hooks/useShareHostel';
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

/**
 * One glyph per kind of facility. Before this every row rendered the Wi-Fi
 * icon, so Hot water and Laundry appeared with a wifi mark.
 */
const FACILITY_ICONS: Record<FacilityIcon, typeof Wifi> = {
  wifi: Wifi,
  water: Droplets,
  'hot-water': Flame,
  laundry: Shirt,
  cleaning: Sparkles,
  power: Zap,
  bathroom: ShowerHead,
  food: UtensilsCrossed,
  parking: Car,
  security: ShieldCheck,
  generic: CircleDot,
};

const UTILITY_DETAIL_KEY: Record<string, string> = { WATER: 'water', WIFI: 'wifi', ELECTRICITY: 'electricity', CLEANING: 'cleaning' };
const STATUS_COLOR: Record<string, string> = { OK: 'bg-success', ISSUE: 'bg-warning', OUTAGE: 'bg-destructive' };
const STATUS_LABEL: Record<string, string> = { OK: 'Normal', ISSUE: 'Minor issue', OUTAGE: 'Outage' };

const TICKET_STEPS: Array<{ key: string; label: string }> = [
  { key: 'RAISED', label: 'Raised' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'RESOLVED', label: 'Resolved' },
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
  const { share: shareHostel } = useShareHostel();
  const room = useTenantRoom();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [moveOutOpen, setMoveOutOpen] = useState(false);
  // Owner-authored and admin-approved, plus this room's Wi-Fi. See facilities.ts.
  const facilities = useMemo(
    () => buildTenantFacilities({ amenities: room.facilities, room: room.room }),
    [room.facilities, room.room],
  );
  const profile = useTenantProfile();
  const overlay = useOverlayStack();
  const [openRuleSection, setOpenRuleSection] = useState<string | null>(null);

  const resolvedRequests = useMemo(() => room.requests.filter((r) => r.status === 'RESOLVED'), [room.requests]);

  const detailConfigs = useMemo(
    () => buildRoomDetailConfigs({ room: room.room, roommates: room.roommates, facilities, resolvedRequests, push: overlay.push, onInviteToRoom: () => setShareOpen(true) }),
    [room.room, room.roommates, facilities, resolvedRequests, overlay.push],
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
          {facilities.length === 0 ? (
            /*
              Nothing invented. This section used to render six hardcoded rows —
              hot-water timings, a laundry location, a housekeeping frequency —
              that were true of no hostel in particular. An absent section is
              honest; six confident lies are not.
            */
            <div className={`${card} px-4 py-5 text-center`}>
              <div className="text-[13px] font-semibold text-[#6E635A]">Not listed yet</div>
              <div className="mt-1 text-[11.5px] text-[#9A8F84]">
                Your hostel hasn’t published its facilities. Ask at the front desk in the meantime.
              </div>
            </div>
          ) : (
            <div className={`${card} divide-y divide-border px-4`}>
              {facilities.map((facility) => {
                const Icon = FACILITY_ICONS[facility.icon] ?? FACILITY_ICONS.generic;
                return (
                  <button
                    key={facility.key}
                    type="button"
                    onClick={() => overlay.push(`facility:${facility.key}`)}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-[#2A2521]">{facility.label}</div>
                      {facility.detail && (
                        <div className="mt-0.5 truncate text-[11.5px] font-medium text-[#9A8F84]">{facility.detail}</div>
                      )}
                    </div>
                    {facility.schedule && (
                      <span className="flex-none rounded-full bg-warning-bg px-2.5 py-1 text-[10.5px] font-bold text-warning">
                        {facility.schedule}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {room.room && (
          <button
            type="button"
            onClick={() => overlay.push('svc_room_change')}
            className={`${card} flex items-center gap-3 px-4 py-3.5 text-left`}
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
              <Repeat className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-[#2A2521]">Request room change</span>
              <span className="block text-[11px] text-muted-foreground">Ask to move to a different room</span>
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
          </button>
        )}

        {room.activeTicket && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <span className={sectionLabel}>Complaints</span>
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

        {/*
          Moving out sits last and stays quiet. It settles a deposit, frees the
          bed and puts a request in front of the owner — consequential enough
          that it should not compete with Facilities for a thumb, and permanent
          enough that it should never be a tap away by accident.
        */}
        {room.room && (
          <button
            type="button"
            onClick={() => setMoveOutOpen(true)}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-[12.5px] font-semibold text-[#9A8F84]"
          >
            <LogOut className="h-4 w-4" />
            Request to move out
          </button>
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

      <MoveOutSheet
        open={moveOutOpen}
        onClose={() => setMoveOutOpen(false)}
        roomNo={room.room?.room_no ?? null}
        hostelName={room.hostel.name}
      />

      {room.hostel.public_slug && (
        <ShareSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          hostel={{ name: room.hostel.name ?? 'this hostel', slug: room.hostel.public_slug, city: null }}
          url={buildShareUrl(room.hostel.public_slug, window.location.origin)}
          copied={shareCopied}
          onCopy={async () =>
            setShareCopied(await copyToClipboard(buildShareUrl(room.hostel.public_slug as string, window.location.origin)))
          }
          onNativeShare={
            typeof navigator !== 'undefined' && typeof navigator.share === 'function'
              ? () => shareHostel({ name: room.hostel.name ?? 'this hostel', slug: room.hostel.public_slug as string, city: null })
              : null
          }
        />
      )}
    </div>
  );
}
