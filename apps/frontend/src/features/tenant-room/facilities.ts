/**
 * What a hostel actually provides, as one list.
 *
 * The Room tab used to render six hardcoded rows — "Hot water 6–10 AM · 6–10
 * PM", "Laundry · ground floor", "Drinking water RO purifier · corridor" —
 * written into the component and true of nobody's hostel in particular. This
 * builds the same list out of what the owner wrote and an admin approved.
 *
 * Two sources, deliberately different (see the spec's §3/§4):
 *
 * - **Amenities** come from the APPROVED marketing revision, so a tenant and
 *   someone browsing Discovery read the same words, and neither reads anything
 *   an owner published unreviewed.
 * - **Wi-Fi credentials** come from the room and are never reviewed and never
 *   public. A password behind an approval queue is absurd; a password on a
 *   public listing is worse.
 *
 * PURE — no DOM, no network. The components are renderers over this.
 */

import { describeAvailability } from '@shared/lib/amenityAvailability';

export interface OwnerAmenity {
  label: string;
  enabled?: boolean;
  icon?: string | null;
  availability?: 'ALWAYS' | 'HOURS' | 'NOTE' | null;
  availabilityValue?: string | null;
  availabilitySlots?: { start: string; end: string }[] | null;
}

export interface RoomWifi {
  wifi_name?: string | null;
  wifi_password?: string | null;
}

/** A row on the facilities list, whatever it was built from. */
export interface Facility {
  key: string;
  label: string;
  /** The line underneath — a note, when the owner wrote one. */
  detail: string | null;
  /** The pill — when it is available. */
  schedule: string | null;
  /** Chooses the glyph. Every row used to get the Wi-Fi icon regardless. */
  icon: FacilityIcon;
  /** Wi-Fi carries credentials; nothing else does. */
  wifi?: { ssid: string | null; password: string | null };
}

export type FacilityIcon =
  | 'wifi'
  | 'water'
  | 'hot-water'
  | 'laundry'
  | 'cleaning'
  | 'power'
  | 'bathroom'
  | 'food'
  | 'parking'
  | 'security'
  | 'generic';

/**
 * Guess the glyph from what the owner called it.
 *
 * Owners type their own labels, so this matches on words rather than requiring
 * a fixed vocabulary — and falls back to a generic mark instead of pretending.
 * The old code gave every row the Wi-Fi icon, which is why Hot water and
 * Laundry appeared with a wifi glyph.
 */
export function iconForLabel(label: string, explicit?: string | null): FacilityIcon {
  const named = String(explicit ?? '').trim().toLowerCase();
  if (named && isFacilityIcon(named)) return named;

  const text = String(label ?? '').toLowerCase();
  if (/wi-?fi|internet|broadband/.test(text)) return 'wifi';
  if (/hot\s*water|geyser|heater/.test(text)) return 'hot-water';
  if (/drink|ro\b|purifier|water/.test(text)) return 'water';
  if (/laundry|washing|dhobi/.test(text)) return 'laundry';
  if (/clean|housekeep|sweep/.test(text)) return 'cleaning';
  if (/power|electric|backup|generator|inverter/.test(text)) return 'power';
  if (/bath|toilet|washroom/.test(text)) return 'bathroom';
  if (/food|mess|meal|kitchen|canteen/.test(text)) return 'food';
  if (/park/.test(text)) return 'parking';
  if (/cctv|security|guard|warden/.test(text)) return 'security';
  return 'generic';
}

function isFacilityIcon(value: string): value is FacilityIcon {
  return [
    'wifi', 'water', 'hot-water', 'laundry', 'cleaning',
    'power', 'bathroom', 'food', 'parking', 'security', 'generic',
  ].includes(value);
}

/** Stable key from the label, so React keys survive a reorder. */
function keyFor(label: string, index: number): string {
  const slug = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `fac-${slug}` : `fac-${index}`;
}

/**
 * Build the tenant's list: the approved amenities, with the room's Wi-Fi
 * credentials attached to whichever row is the Wi-Fi one.
 *
 * When the owner never listed Wi-Fi as an amenity but the room has credentials,
 * a Wi-Fi row is still added — the tenant needs the password, and its absence
 * from a marketing list is not a reason to withhold it.
 */
export function buildTenantFacilities(input: {
  amenities: OwnerAmenity[] | null | undefined;
  room: RoomWifi | null | undefined;
}): Facility[] {
  const amenities = (input.amenities ?? []).filter((a) => a && a.enabled !== false && String(a.label ?? '').trim());

  const rows: Facility[] = amenities.map((amenity, index) => {
    const icon = iconForLabel(amenity.label, amenity.icon);
    const row: Facility = {
      key: keyFor(amenity.label, index),
      label: String(amenity.label).trim(),
      // One structured choice, rendered two ways: a scannable pill for a time
      // range, a sentence beneath for a note. See amenityAvailability.
      detail: describeAvailability(amenity).line,
      schedule: describeAvailability(amenity).pill,
      icon,
    };
    if (icon === 'wifi') row.wifi = readWifi(input.room);
    return row;
  });

  if (!rows.some((row) => row.icon === 'wifi')) {
    const wifi = readWifi(input.room);
    if (wifi.ssid || wifi.password) {
      rows.unshift({ key: 'fac-wi-fi', label: 'Wi-Fi', detail: null, schedule: null, icon: 'wifi', wifi });
    }
  }

  return rows;
}

function readWifi(room: RoomWifi | null | undefined) {
  return {
    ssid: emptyToNull(room?.wifi_name),
    password: emptyToNull(room?.wifi_password),
  };
}

function emptyToNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

/**
 * What to show where a Wi-Fi password would go.
 *
 * "Ask the front desk" is the honest answer when nobody has entered one — it
 * tells the tenant what to actually do. It must never read as though the
 * network is down, because an unset field says nothing about the network.
 */
export function wifiCredentialLine(wifi: { ssid: string | null; password: string | null } | undefined): {
  ssid: string;
  password: string;
  configured: boolean;
} {
  const ssid = wifi?.ssid ?? null;
  const password = wifi?.password ?? null;
  return {
    ssid: ssid ?? 'Ask the front desk',
    password: password ?? 'Ask the front desk',
    configured: Boolean(ssid || password),
  };
}
