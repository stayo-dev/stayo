/**
 * Owner routes that are nested *inside* `OwnerAppShell` but must still render as
 * a full-screen takeover on mobile — no bottom nav, no 480px frame — the same
 * contract the tenant side's `AppBottomNav.hidesOuterNav()` enforces.
 *
 * As of Phase 2.1 that is only the Tenant Detail pane
 * (`/owner/tenants/:tenantId`, nested under `/owner/tenants` so `<MasterDetail>`
 * can render it through `<Outlet/>` at `lg+`). Hostel drilldown and the work
 * queues join this list in later phases as they move onto `<MasterDetail>`.
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
  if (!/^\/owner\/tenants\/[^/]+$/.test(pathname)) return false;
  return !/\/(verifications|activations)$/.test(pathname);
}
