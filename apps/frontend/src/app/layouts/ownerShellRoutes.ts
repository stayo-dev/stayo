/**
 * Owner routes that are nested *inside* `OwnerAppShell` but must still render as
 * a full-screen takeover on mobile — no bottom nav, no 480px frame — the same
 * contract the tenant side's `AppBottomNav.hidesOuterNav()` enforces.
 *
 * As of Phase 2.3 that is:
 * - the Tenant Detail pane (`/owner/tenants/:tenantId`, nested under
 *   `/owner/tenants` so `<MasterDetail>` renders it through `<Outlet/>` at `lg+`);
 * - the Hostel Drilldown pane and its tabs (`/owner/hostels/:hostelId[/overview
 *   |rooms|tenants|settings|marketing]`, nested under `/owner/hostels`).
 *
 * The Hostel Builder (`/owner/hostels/new`, `/owner/hostels/:hostelId/build`) is
 * a full-screen flow declared *outside* `OwnerAppShell` — it never reaches this
 * check, and is excluded here defensively anyway. The work queues join this list
 * in later phases as they move onto `<MasterDetail>`.
 *
 * At `lg+` this is irrelevant — `OwnerAppShell` renders the console around every
 * owner route regardless.
 *
 * Pure so `OwnerAppShell` can branch on it without a test needing to render.
 */
export function isOwnerFullBleedPath(pathname: string): boolean {
  // `/owner/tenants/<id>` — exactly one segment after `/owner/tenants`, and not
  // the sibling queue routes (`/owner/tenants/verifications`,
  // `/owner/tenants/activations`) which are declared *outside* `OwnerAppShell`
  // and never reach it. The `verifications`/`activations` guard is defensive.
  if (/^\/owner\/tenants\/[^/]+$/.test(pathname)) {
    return !/\/(verifications|activations)$/.test(pathname);
  }

  // `/owner/hostels/<id>` or `<id>/<drilldown tab>` — the master-detail pane.
  // Not `/owner/hostels/new` (the builder) and not `<id>/build` (resume builder)
  // — both are outside `OwnerAppShell` and never reach here; excluded defensively.
  if (/^\/owner\/hostels\/(?!new(?:\/|$))[^/]+(?:\/(overview|rooms|tenants|settings|marketing))?$/.test(pathname)) {
    return true;
  }

  return false;
}
