import { Droplets, Wifi, Zap, Sparkles, Shirt, Flame, GlassWater, ShowerHead } from 'lucide-react';
import { createElement } from 'react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { TenantRoom, TenantRoommate, UtilityStatusRow, ServiceRequest } from '@features/tenant-room/api';
import type { DetailConfig } from '../types';

const UTILITY_STATUS_META: Record<string, { big: string; sub: string; tone: 'green' | 'yellow' | 'red' }> = {
  OK: { big: 'Available', sub: 'Running normally', tone: 'green' },
  ISSUE: { big: 'Minor issue', sub: 'Being looked into', tone: 'yellow' },
  OUTAGE: { big: 'Outage', sub: 'Currently unavailable', tone: 'red' },
};

interface RoomDetailContext {
  room: TenantRoom | null;
  roommates: TenantRoommate[];
  utilityStatus: UtilityStatusRow[];
  resolvedRequests: ServiceRequest[];
  push: (view: string) => void;
}

function utilityConfig(key: string, icon: ReturnType<typeof createElement>, title: string, sub: string, ctx: RoomDetailContext): DetailConfig {
  const row = ctx.utilityStatus.find((u) => u.utility === key);
  const meta = UTILITY_STATUS_META[row?.status ?? 'OK'];
  const config: DetailConfig = {
    title,
    sub,
    sections: [
      { kind: 'status', icon, big: meta.big, sub: meta.sub, tone: meta.tone },
    ],
  };
  if (row?.note) {
    config.sections.push({ kind: 'notices', title: 'Notice', notices: [{ title: row.note, meta: `Updated ${new Date(row.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, tone: meta.tone }] });
  }
  return config;
}

/** Static Room-drill-in destinations — Stayo Tenant.dc.html's DETAIL map, ported using real room/roommate/utility data where the backend tracks it. Ticket detail (`maint_ticket`, `tk_*`) is built separately (needs a live per-id events fetch) — see `buildServiceRequestDetailConfig`. */
export function buildRoomDetailConfigs(ctx: RoomDetailContext): Record<string, DetailConfig> {
  const room = ctx.room;
  const configs: Record<string, DetailConfig> = {
    room_details: {
      title: 'Room details',
      sub: room ? `Room ${room.room_no}` : 'Your room',
      sections: [
        {
          kind: 'chips',
          title: 'Overview',
          chips: [
            { k: 'Room', v: room?.room_no ?? '—' },
            { k: 'Floor', v: room?.floor ?? '—' },
            { k: 'Sharing', v: room?.capacity ? `${room.capacity}-sharing` : '—' },
            { k: 'Roommates', v: String(ctx.roommates.length) },
          ],
        },
        ...(room?.notes ? [{ kind: 'notices' as const, title: 'Notes', notices: [{ title: room.notes, meta: 'From your hostel', tone: 'grey' as const }] }] : []),
        {
          kind: 'actions',
          actions: [{ label: 'Request room change', style: 'primary', onClick: () => ctx.push('svc_room_change') }],
        },
      ],
    },
    water: utilityConfig('WATER', createElement(Droplets, { className: 'h-5 w-5' }), 'Water supply', room ? `Live status · Room ${room.room_no}` : 'Live status', ctx),
    wifi: {
      title: 'Wi-Fi',
      sub: room ? `Room ${room.room_no} network` : 'Network',
      sections: [
        { kind: 'status', icon: createElement(Wifi, { className: 'h-5 w-5' }), ...(() => { const row = ctx.utilityStatus.find((u) => u.utility === 'WIFI'); const meta = UTILITY_STATUS_META[row?.status ?? 'OK']; return { big: meta.big, sub: meta.sub, tone: meta.tone }; })() },
        { kind: 'rows', title: 'Network', rows: [
          { label: 'SSID', value: room?.wifi_name ?? 'Not set' },
          { label: 'Password', value: room?.wifi_password ?? 'Ask the front desk', mono: true },
        ] },
        { kind: 'actions', actions: [{ label: 'Report a problem', style: 'dark', onClick: () => ctx.push('maint_new') }] },
      ],
    },
    electricity: utilityConfig('ELECTRICITY', createElement(Zap, { className: 'h-5 w-5' }), 'Electricity', room ? `Room ${room.room_no} power` : 'Power', ctx),
    cleaning: {
      title: 'Cleaning',
      sub: room ? `Room ${room.room_no} housekeeping` : 'Housekeeping',
      sections: [
        { kind: 'status', icon: createElement(Sparkles, { className: 'h-5 w-5' }), ...(() => { const row = ctx.utilityStatus.find((u) => u.utility === 'CLEANING'); const meta = UTILITY_STATUS_META[row?.status ?? 'OK']; return { big: meta.big, sub: meta.sub, tone: meta.tone }; })() },
        { kind: 'actions', actions: [{ label: 'Request extra cleaning', style: 'primary', onClick: () => ctx.push('svc_cleaning') }] },
      ],
    },
    maint_history: {
      title: 'Ticket history',
      sub: room ? `Resolved requests · Room ${room.room_no}` : 'Resolved requests',
      sections:
        ctx.resolvedRequests.length > 0
          ? [
              {
                kind: 'notices',
                title: 'Resolved',
                notices: ctx.resolvedRequests.map((r) => ({
                  title: r.category ?? r.type.replace('_', ' '),
                  meta: `Resolved ${new Date(r.updated_at ?? r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
                  tone: 'green' as const,
                })),
              },
              { kind: 'actions', actions: [{ label: 'Raise a new request', style: 'primary', onClick: () => ctx.push('maint_new') }] },
            ]
          : [{ kind: 'empty', title: 'No resolved requests yet', body: 'Anything you raise and get resolved will show up here.' }],
    },
    vacant: { title: 'Vacant bed', sub: room ? `Room ${room.room_no}` : 'This bed', sections: [{ kind: 'empty', title: 'This bed is currently vacant', body: 'A new tenant may be allocated soon. You’ll be notified when someone moves in.' }] },
    // Facility amenity screens describe standard hostel policy/amenities, not
    // per-tenant live sensor data (the backend only tracks live status for the
    // 4 utilities above) — content matches Stayo Tenant.dc.html verbatim.
    fac_hotwater: {
      title: 'Hot water', sub: 'Attached bathroom',
      sections: [
        { kind: 'status', icon: createElement(Flame, { className: 'h-5 w-5' }), big: 'Scheduled', sub: 'Available at set times', tone: 'yellow' },
        { kind: 'rows', title: 'Schedule', rows: [{ label: 'Morning', value: '6 – 10 AM' }, { label: 'Evening', value: '6 – 10 PM' }] },
      ],
    },
    fac_laundry: {
      title: 'Laundry', sub: 'Shared facility',
      sections: [
        { kind: 'status', icon: createElement(Shirt, { className: 'h-5 w-5' }), big: 'Available', sub: 'Shared facility', tone: 'green' },
        { kind: 'rows', title: 'Details', rows: [{ label: 'Location', value: 'Ground floor' }, { label: 'Timing', value: '7 AM – 9 PM' }] },
        { kind: 'notices', title: 'Instructions', notices: [{ title: 'Collect tokens from the front desk', meta: 'Per-wash charge applies', tone: 'grey' }] },
      ],
    },
    fac_drinking: {
      title: 'Drinking water', sub: 'RO purifier',
      sections: [
        { kind: 'status', icon: createElement(GlassWater, { className: 'h-5 w-5' }), big: 'Available', sub: '24×7 access', tone: 'green' },
        { kind: 'rows', title: 'Details', rows: [{ label: 'Type', value: 'RO purified' }, { label: 'Location', value: 'Corridor' }] },
      ],
    },
    fac_housekeeping: {
      title: 'Housekeeping', sub: 'Room cleaning service',
      sections: [
        { kind: 'status', icon: createElement(Sparkles, { className: 'h-5 w-5' }), big: 'Scheduled', sub: 'Regular housekeeping', tone: 'green' },
        { kind: 'actions', actions: [{ label: 'Request extra cleaning', style: 'primary', onClick: () => ctx.push('svc_cleaning') }] },
      ],
    },
    fac_bathroom: {
      title: 'Attached bathroom', sub: room ? `Private to Room ${room.room_no}` : 'Private bathroom',
      sections: [
        { kind: 'status', icon: createElement(ShowerHead, { className: 'h-5 w-5' }), big: 'Private', sub: 'For your room only', tone: 'green' },
        { kind: 'actions', actions: [{ label: 'Report an issue', style: 'dark', onClick: () => ctx.push('maint_new') }] },
      ],
    },
  };

  ctx.roommates.forEach((mate, i) => {
    configs[`mate_${i}`] = {
      title: 'Roommate',
      sub: room ? `Shares Room ${room.room_no}` : 'Shares your room',
      sections: [
        { kind: 'person', initial: mate.name.charAt(0).toUpperCase(), name: mate.name, role: 'Roommate', tag1: room ? `Room ${room.room_no}` : '', tag2: 'Current tenant' },
        { kind: 'actions', actions: [{ label: 'Message · coming soon', style: 'ghost', onClick: () => stayoToast.info('Messaging arrives soon') }] },
      ],
    };
  });

  return configs;
}
