import { createElement } from 'react';
import { Wifi, Droplets, Flame, Shirt, Sparkles, Zap, ShowerHead, UtensilsCrossed, Car, ShieldCheck, CircleDot, UserPlus } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { TenantRoom, TenantRoommate, ServiceRequest } from '@features/tenant-room/api';
import { wifiCredentialLine, type Facility, type FacilityIcon } from '@features/tenant-room/facilities';
import type { DetailConfig } from '../types';

/**
 * The Room tab's drill-in screens.
 *
 * ## What changed, and why
 *
 * This file used to carry two kinds of fiction.
 *
 * **Live utility status** (water/wifi/electricity/cleaning) drove four screens
 * off `hostel_utility_status` — a table with **zero rows product-wide** and no
 * owner UI to write it. Every screen therefore rendered its `?? 'OK'` default:
 * "Available · Running normally", asserted about a hostel nobody had reported
 * on. Those screens are gone.
 *
 * **Hardcoded facility screens** (`fac_hotwater`, `fac_laundry`, …) carried
 * timings and locations lifted verbatim from the design mock — "6 – 10 AM",
 * "Ground floor", "RO purified · Corridor" — true of no hostel in particular.
 * They are replaced by screens built from what the owner actually wrote and an
 * admin approved.
 *
 * A tenant reading this tab now reads facts or nothing.
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

interface RoomDetailContext {
  room: TenantRoom | null;
  roommates: TenantRoommate[];
  /** Owner-authored, admin-approved. See features/tenant-room/facilities.ts. */
  facilities: Facility[];
  resolvedRequests: ServiceRequest[];
  push: (view: string) => void;
  /** Opens the share sheet, so a tenant can fill an empty bed themselves. */
  onInviteToRoom?: () => void;
}

/**
 * Every facility gets the same screen: what the owner said, then a way to say
 * it is broken.
 *
 * Reporting lives **here** rather than in a grid of service tiles, because a
 * report raised from the Hot water screen arrives already knowing it is about
 * hot water. Nothing has to be triaged into a category the tenant already
 * chose by tapping.
 */
function facilityConfig(facility: Facility, ctx: RoomDetailContext): DetailConfig {
  const icon = createElement(FACILITY_ICONS[facility.icon] ?? CircleDot, { className: 'h-5 w-5' });
  const sections: DetailConfig['sections'] = [
    {
      kind: 'status',
      icon,
      big: facility.schedule ?? 'Available',
      sub: facility.detail ?? 'Provided by your hostel',
      tone: 'green',
    },
  ];

  if (facility.wifi) {
    const line = wifiCredentialLine(facility.wifi);
    sections.push({
      kind: 'rows',
      title: 'Network',
      rows: [
        { label: 'Network name', value: line.ssid },
        { label: 'Password', value: line.password },
      ],
    });
  }

  sections.push({
    kind: 'actions',
    actions: [{ label: 'Report a problem', style: 'dark', onClick: () => ctx.push('maint_new') }],
  });

  return { title: facility.label, sub: facility.detail ?? 'Room facility', sections };
}

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

    /**
     * An empty bed used to be a dead end: "a new tenant may be allocated soon",
     * nothing to do. The person most motivated to fill it — and best placed to
     * pick who they live with — is the tenant already in the room.
     */
    vacant: {
      title: 'Invite a friend',
      sub: room ? `Room ${room.room_no}` : 'This room',
      sections: [
        {
          kind: 'status',
          icon: createElement(UserPlus, { className: 'h-5 w-5' }),
          big: 'Bed available',
          sub: 'Know someone looking for a place?',
          tone: 'green',
        },
        {
          kind: 'actions',
          actions: [
            {
              label: 'Share this hostel',
              style: 'primary',
              onClick: () =>
                ctx.onInviteToRoom
                  ? ctx.onInviteToRoom()
                  : stayoToast.info('Sharing is unavailable right now'),
            },
          ],
        },
      ],
    },
  };

  // One screen per facility the owner actually published.
  ctx.facilities.forEach((facility) => {
    configs[`facility:${facility.key}`] = facilityConfig(facility, ctx);
  });

  ctx.roommates.forEach((mate, i) => {
    configs[`mate_${i}`] = {
      title: 'Roommate',
      sub: room ? `Shares Room ${room.room_no}` : 'Shares your room',
      sections: [
        {
          kind: 'person',
          initial: mate.name.charAt(0).toUpperCase(),
          name: mate.name,
          role: 'Roommate',
          tag1: room ? `Room ${room.room_no}` : '',
          tag2: 'Current tenant',
        },
        // Name and phone, nothing more. Enough to knock on a door or call, and
        // nothing a roommate would resent being handed to the next bed.
        ...(mate.phone
          ? [{ kind: 'rows' as const, title: 'Contact', rows: [{ label: 'Phone', value: mate.phone }] }]
          : []),
      ],
    };
  });

  return configs;
}
