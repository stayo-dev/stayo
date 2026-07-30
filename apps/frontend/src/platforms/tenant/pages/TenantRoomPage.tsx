import { useState } from 'react';
import { Wifi, Droplets, Zap, Sparkles, Wrench, DoorOpen, KeyRound, UserPlus, BedDouble, ChevronDown, ListChecks } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useTenantRoom } from '@features/tenant-room/hooks/useTenantRoom';
import { ServiceRequestSheet, type RequestTypeConfig } from '@features/tenant-room/components/ServiceRequestSheet';
import type { ServiceRequestType } from '@features/tenant-room/api';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold uppercase tracking-wide text-muted-foreground';

const UTILITY_META: Record<string, { label: string; icon: typeof Wifi }> = {
  WATER: { label: 'Water supply', icon: Droplets },
  WIFI: { label: 'Wi-Fi', icon: Wifi },
  ELECTRICITY: { label: 'Electricity', icon: Zap },
  CLEANING: { label: 'Cleaning', icon: Sparkles },
};
const UTILITY_ORDER = ['WATER', 'WIFI', 'ELECTRICITY', 'CLEANING'];
const STATUS_COLOR: Record<string, string> = { OK: 'bg-success', ISSUE: 'bg-warning', OUTAGE: 'bg-destructive' };
const STATUS_LABEL: Record<string, string> = { OK: 'Normal', ISSUE: 'Minor issue', OUTAGE: 'Outage' };
const STATUS_TILE: Record<string, string> = {
  OK: 'border-border bg-card',
  ISSUE: 'border-[#F0DFB8] bg-[#FBF3E2]',
  OUTAGE: 'border-[#F0C6BE] bg-[#FBE4E1]',
};

const TICKET_STEPS: Array<{ key: string; label: string }> = [
  { key: 'RAISED', label: 'Raised' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'RESOLVED', label: 'Resolved' },
];

const REQUEST_CONFIGS: Record<ServiceRequestType, RequestTypeConfig> = {
  MAINTENANCE: {
    type: 'MAINTENANCE',
    title: 'New maintenance request',
    categories: ['Electrical', 'Water', 'Furniture', 'Cleaning', 'Internet', 'Other'],
    descriptionLabel: 'Describe the issue',
    descriptionPlaceholder: 'e.g. Fan in the room is not working',
  },
  ROOM_CHANGE: {
    type: 'ROOM_CHANGE',
    title: 'Room change request',
    descriptionLabel: 'Reason for the change',
    descriptionPlaceholder: 'Tell us why you’d like to move rooms',
  },
  CLEANING: {
    type: 'CLEANING',
    title: 'Cleaning request',
    descriptionLabel: 'Anything specific?',
    descriptionPlaceholder: 'Optional notes for housekeeping',
  },
  LOST_KEY: {
    type: 'LOST_KEY',
    title: 'Report a lost key',
    descriptionLabel: 'Details',
    descriptionPlaceholder: 'When did you last have it?',
    feeNote: 'A replacement fee may apply — the hostel will confirm the amount.',
  },
  VISITOR_PASS: {
    type: 'VISITOR_PASS',
    title: 'Register a visitor pass',
    inputs: [
      { key: 'name', label: 'Visitor name', type: 'text', placeholder: 'Full name', required: true },
      { key: 'phone', label: 'Phone', type: 'tel', placeholder: '10-digit number' },
      { key: 'date', label: 'Visit date', type: 'text', placeholder: 'e.g. 27 Jul' },
      { key: 'time', label: 'Arrival time', type: 'text', placeholder: 'e.g. 4:00 PM' },
    ],
  },
  EXTRA_MATTRESS: {
    type: 'EXTRA_MATTRESS',
    title: 'Extra mattress request',
    descriptionLabel: 'Notes',
    descriptionPlaceholder: 'Temporary or permanent? Any preference?',
    feeNote: 'A monthly charge may apply for a permanent extra mattress.',
  },
};

const SERVICES: Array<{ type: ServiceRequestType; title: string; sub: string; icon: typeof Wrench }> = [
  { type: 'ROOM_CHANGE', title: 'Room change', sub: 'Request a different room', icon: DoorOpen },
  { type: 'CLEANING', title: 'Cleaning request', sub: 'Schedule housekeeping', icon: Sparkles },
  { type: 'LOST_KEY', title: 'Lost key', sub: 'Report a missing key', icon: KeyRound },
  { type: 'VISITOR_PASS', title: 'Visitor pass', sub: 'Register a guest', icon: UserPlus },
  { type: 'EXTRA_MATTRESS', title: 'Extra mattress', sub: 'Request extra bedding', icon: BedDouble },
  { type: 'MAINTENANCE', title: 'Maintenance', sub: 'Report an issue', icon: Wrench },
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

/** Tenant Room tab, per Stayo Tenant.dc.html. Real data via `useTenantRoom()`. */
export function TenantRoomPage() {
  const room = useTenantRoom();
  const [activeRequestType, setActiveRequestType] = useState<ServiceRequestType | null>(null);
  const [openRuleSection, setOpenRuleSection] = useState<string | null>(null);

  if (room.isLoading) return <LoadingSkeleton />;

  const ticketStepIndex = room.activeTicket ? TICKET_STEPS.findIndex((s) => s.key === room.activeTicket!.status) : -1;

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">My Room</h1>
      </div>

      <div className="relative overflow-hidden rounded-[20px] bg-foreground p-5 text-background shadow-[0_10px_26px_rgba(34,30,26,0.18)]">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-[130px] w-[130px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(217,144,111,0.2), transparent 70%)' }}
        />
        <div className="relative flex items-center gap-3.5">
          <span className="flex h-13 w-13 flex-none items-center justify-center rounded-[14px] bg-primary font-display text-[20px] font-extrabold text-white shadow-[0_6px_14px_rgba(180,106,85,0.4)]">
            {room.room?.room_no ?? '—'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-extrabold text-white">Room {room.room?.room_no ?? '—'}</div>
            <div className="mt-0.5 text-[12px] font-medium text-[#B9AFA3]">
              {room.room?.floor ? `${room.room.floor} floor` : 'Your stay'}
            </div>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-white/[0.07] px-3 py-2.5 text-center">
            <div className="font-display text-[14px] font-extrabold text-white">{room.room?.capacity ? `${room.roommates.length + 1}/${room.room.capacity}` : '—'}</div>
            <div className="mt-0.5 text-[9.5px] font-semibold text-[#B9AFA3]">Beds</div>
          </div>
          <div className="rounded-xl bg-white/[0.07] px-3 py-2.5 text-center">
            <div className="font-display text-[14px] font-extrabold text-white">{room.roommates.length}</div>
            <div className="mt-0.5 text-[9.5px] font-semibold text-[#B9AFA3]">Roommates</div>
          </div>
          <div className="rounded-xl bg-white/[0.07] px-3 py-2.5 text-center">
            <div className="font-display text-[14px] font-extrabold text-white">{room.openRequests.length}</div>
            <div className="mt-0.5 text-[9.5px] font-semibold text-[#B9AFA3]">Open requests</div>
          </div>
        </div>
        {!room.hasOpenComplaint && (
          <div className="relative mt-3.5 flex items-center gap-2 rounded-xl bg-[rgba(127,191,155,0.13)] px-3.5 py-2.5">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
            <span className="text-[11.5px] font-semibold text-[#7FBF9B]">No open issues with your room right now</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <span className={sectionLabel}>Living status</span>
        <div className="grid grid-cols-2 gap-2.5">
          {UTILITY_ORDER.map((key) => {
            const row = room.utilityStatus.find((u) => u.utility === key);
            const meta = UTILITY_META[key];
            const status = row?.status ?? 'OK';
            return (
              <div key={key} className={`rounded-[13px] border p-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)] ${STATUS_TILE[status]}`}>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-white shadow-[0_1px_3px_rgba(40,30,20,0.08)]">
                    <meta.icon className="h-4 w-4 text-[#8A7F75]" />
                  </span>
                  <span className="text-[12px] font-semibold text-foreground">{meta.label}</span>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[status]}`} />
                  <span className="text-[11px] font-medium text-[#8A7F75]">{STATUS_LABEL[status]}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {room.roommates.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Roommates</span>
          <div className={`${card} divide-y divide-border px-4`}>
            {room.roommates.map((m, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-secondary font-display text-[12.5px] font-bold text-primary">
                  {m.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <span className="text-[13.5px] font-semibold text-foreground">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {room.activeTicket && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Maintenance</span>
          <div className={`${card} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-[14.5px] font-bold text-foreground">
                  {room.activeTicket.category ?? 'Maintenance'} issue
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{room.activeTicket.description}</div>
              </div>
              <span className="flex-none rounded-full bg-warning/10 px-2.5 py-1 text-[10.5px] font-bold text-warning">
                {room.activeTicket.status.replace('_', ' ')}
              </span>
            </div>
            <div className="mt-4 flex items-center">
              {TICKET_STEPS.map((step, i) => (
                <div key={step.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                        i <= ticketStepIndex ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="whitespace-nowrap text-[9px] font-semibold text-muted-foreground">{step.label}</span>
                  </div>
                  {i < TICKET_STEPS.length - 1 && (
                    <div className={`mx-1 h-0.5 flex-1 ${i < ticketStepIndex ? 'bg-primary' : 'bg-muted'}`} style={{ marginBottom: 14 }} />
                  )}
                </div>
              ))}
            </div>
            {room.activeTicket.assigned_to && (
              <p className="mt-3 text-[11.5px] text-muted-foreground">Assigned to {room.activeTicket.assigned_to}</p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <span className={sectionLabel}>Room services</span>
        <div className="grid grid-cols-2 gap-2.5">
          {SERVICES.map(({ type, title, sub, icon: Icon }) => (
            <button key={type} type="button" onClick={() => setActiveRequestType(type)} className={`${card} flex items-center gap-3 px-3.5 py-3`}>
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-secondary text-primary">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12.5px] font-semibold leading-tight text-foreground">{title}</span>
                <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {room.houseRules.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>House rules</span>
          <div className="rounded-[16px] border border-[#EFE6DA] bg-[#FBF7F2] px-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]">
            {room.houseRules.map((section, idx) => {
              const open = openRuleSection === section.title;
              return (
                <div key={section.title} className={`py-3 ${idx > 0 ? 'border-t border-[#EFE6DA]' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setOpenRuleSection(open ? null : section.title)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] bg-white text-[#9C7A52] shadow-[0_1px_3px_rgba(40,30,20,0.08)]">
                      <ListChecks className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 text-[13.5px] font-semibold text-foreground">{section.title}</span>
                    <ChevronDown className={`h-4 w-4 flex-none text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <ul className="mt-2 flex flex-col gap-1 pl-10">
                      {section.items.map((item, i) => (
                        <li key={i} className="text-[12px] leading-relaxed text-muted-foreground">• {item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ServiceRequestSheet
        config={activeRequestType ? REQUEST_CONFIGS[activeRequestType] : null}
        onClose={() => setActiveRequestType(null)}
        onSubmit={async (data) => {
          try {
            await room.createRequest(data);
            stayoToast.success('Request submitted');
          } catch (err) {
            stayoToast.error('Could not submit request');
            throw err;
          }
        }}
      />
    </div>
  );
}
