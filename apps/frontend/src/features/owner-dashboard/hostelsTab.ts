/**
 * What the Hostels tab shows, decided by how many hostels an owner has.
 *
 * This tab replaces Profile in the bottom nav. Profile held four rarely-opened
 * rows and had a fifth of the app's navigation to itself, while hostels — the
 * thing an owner actually manages — sat at the very bottom of Home, below the
 * rent card, three action tiles, today's revenue and the month's collection
 * summary. The most-managed object in the product was the furthest scroll.
 *
 * The tab is deliberately not one screen:
 *
 * - **single** — an owner with one hostel does not need a list to choose from.
 *   The tab *is* that hostel: its numbers, and the ways into it. A list of one
 *   is a menu with a single item, which is a tap spent on nothing.
 * - **list** — once there is a genuine choice, the existing `PropertyList`
 *   does it, with its Active/Archived tabs, manual ordering (ADR-042) and
 *   Add hostel. This is where a ranking would eventually live: the figures a
 *   leaderboard needs — occupancy, collected, dues, vacant beds — are already
 *   on every card.
 * - **empty** — the ADR-139 guarantee, moved. An owner with no hostels must
 *   always be able to reach "+ Add hostel"; that button previously lived below
 *   a full screen of scrolling on Home and is now a permanent tab.
 *
 * Pure, because the mode is the design: which of three screens an owner is
 * shown should be assertable without rendering any of them.
 */

export interface HostelLike {
  id: string;
  name: string;
  location?: string;
  status?: string;
  occupancyLabel?: string;
  occupancyPercent?: number;
  revenue?: string;
  outstanding?: string;
  outstandingValue?: number;
  vacant?: number;
  activeTenants?: number;
  totalCapacity?: number;
  /** `hostels.hostel_type`, null until the owner answers "who stays here?". */
  hostelType?: string | null;
}

export type HostelsTabMode = 'empty' | 'single' | 'list';

const isArchived = (h: HostelLike) => String(h.status ?? '').toUpperCase() === 'ARCHIVED';

export function hostelsTabMode(properties: HostelLike[] | null | undefined): HostelsTabMode {
  const all = Array.isArray(properties) ? properties : [];
  if (all.length === 0) return 'empty';

  // Exactly one, and it must be live. An owner whose only hostel is archived
  // needs the list — that is the only place it can be reactivated — and an
  // archived hostel alongside a live one would be hidden entirely by the
  // single view, which has no Archived tab.
  if (all.length === 1 && !isArchived(all[0])) return 'single';

  return 'list';
}

export interface SingleHostelOverview {
  id: string;
  name: string;
  location: string;
  occupancyLabel: string;
  occupancyPercent: number;
  revenue: string;
  outstanding: string;
  /** Colours the dues figure and decides whether it is worth drawing attention to. */
  hasDues: boolean;
  vacant: number;
  /** "12 of 46 beds filled", or the unbuilt case. */
  beds: string;
  /**
   * No rooms exist yet. Distinct from an empty hostel: there is nothing to
   * fill, and the owner's next action is building rooms, not finding tenants.
   */
  needsRooms: boolean;
  /**
   * The owner has never been asked who this hostel takes. Not cosmetic: while
   * it is unset, every tenant of this hostel is asked their gender during
   * onboarding, because nothing can derive it. Hostels created before the
   * builder started asking are all in this state.
   */
  needsType: boolean;
}

export function singleHostelOverview(
  properties: HostelLike[] | null | undefined,
): SingleHostelOverview | null {
  if (hostelsTabMode(properties) !== 'single') return null;

  const h = (properties as HostelLike[])[0];
  const capacity = Number(h.totalCapacity ?? 0);
  const filled = Number(h.activeTenants ?? 0);
  const needsRooms = capacity <= 0;

  return {
    id: h.id,
    name: h.name,
    location: h.location || '—',
    occupancyLabel: h.occupancyLabel ?? '0%',
    occupancyPercent: Number(h.occupancyPercent ?? 0),
    revenue: h.revenue ?? '₹0',
    outstanding: h.outstanding ?? '₹0',
    hasDues: Number(h.outstandingValue ?? 0) > 0,
    vacant: Number(h.vacant ?? 0),
    beds: needsRooms ? 'No rooms added yet' : `${filled} of ${capacity} beds filled`,
    needsRooms,
    needsType: !String(h.hostelType || '').trim(),
  };
}
