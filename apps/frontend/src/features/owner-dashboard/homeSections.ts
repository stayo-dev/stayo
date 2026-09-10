/**
 * Which sections of owner Home have earned the right to render.
 *
 * A freshly signed-up owner used to be shown the whole dashboard with nothing
 * in it: a dark hero card reading "Collect Rent ₹0", three tiles of zeros, a
 * month card of "₹0 of ₹0" and a 0% progress bar — before they owned a single
 * room. To someone who is not technical that reads as broken software, not as
 * an empty account, and it buries the one thing they should actually do.
 *
 * So each card here appears at the moment it has something true to say, and
 * Home visibly grows into the dashboard as the owner works: the first tenant
 * brings in the Action Center, the first rent owed brings in the month card.
 *
 * **The hostels list is no longer one of these sections.** It moved to its own
 * bottom-nav tab, so this module no longer decides whether it shows. ADR-139's
 * guarantee moved with it and did not weaken: "+ Add hostel" must always be
 * reachable by an owner with no hostels, and a permanent tab satisfies that
 * more strongly than a button below a screenful of scrolling ever did. The
 * rule is now asserted in `hostelsTab.ts`, which is what decides the empty
 * state.
 */

export interface HomeSectionSignals {
  /** Hostels on the account, including half-built and archived ones. */
  hostelCount: number;
  /** Beds across every hostel. Zero means no rooms have been built yet. */
  roomCapacity: number;
  /** Active + owner-managed. Somebody to act on. */
  tenantCount: number;
  collectedThisMonth: number;
  /** Collected + still owed this month. Non-zero means rent exists. */
  monthTarget: number;
}

export interface HomeSections {
  /** Searching an account with no people in it finds nothing. */
  search: boolean;
  /** Every tile is structurally zero until a tenant exists. */
  actionCenter: boolean;
  monthCard: boolean;
  /** Always. This is the fix. */
  /** No hostel yet — the getting-started card speaks differently. */
  setupMode: boolean;
}

/** Guards against a negative or fractional count reading as presence. */
function has(count: number): boolean {
  return Number.isFinite(count) && count >= 1;
}

export function deriveHomeSections(signals: HomeSectionSignals): HomeSections {
  const hasTenants = has(signals.tenantCount);

  return {
    search: hasTenants,
    actionCenter: hasTenants,
    monthCard: has(signals.collectedThisMonth) || has(signals.monthTarget),
    setupMode: !has(signals.hostelCount),
  };
}
