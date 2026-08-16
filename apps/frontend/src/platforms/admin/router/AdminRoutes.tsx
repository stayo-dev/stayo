import { lazy } from 'react';
import { Navigate, Route } from 'react-router-dom';

const AdminConsoleShell = lazy(() =>
  import('../layout/AdminConsoleShell').then((m) => ({ default: m.AdminConsoleShell })),
);
const AdminProviderShell = lazy(() =>
  import('./AdminProviderShell').then((m) => ({ default: m.AdminProviderShell })),
);

const OverviewPage = lazy(() => import('../pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const LeadsPage = lazy(() => import('../pages/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const OwnersPage = lazy(() => import('../pages/OwnersPage').then((m) => ({ default: m.OwnersPage })));
const KycPage = lazy(() => import('../pages/KycPage').then((m) => ({ default: m.KycPage })));
const ListingsPage = lazy(() => import('../pages/ListingsPage').then((m) => ({ default: m.ListingsPage })));
const RevenuePage = lazy(() => import('../pages/RevenuePage').then((m) => ({ default: m.RevenuePage })));
const SettlementsPage = lazy(() => import('../pages/SettlementsPage').then((m) => ({ default: m.SettlementsPage })));
const SubscriptionsPage = lazy(() => import('../pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })));
const ReportsPage = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const BroadcastsPage = lazy(() => import('../pages/BroadcastsPage').then((m) => ({ default: m.BroadcastsPage })));
/**
 * The owner's marketing editor, reused verbatim. Stayo's team authors and
 * manages listing pages for any hostel — including ones an owner already runs
 * — so the admin console mounts the same component rather than growing a
 * second editor that would drift from it.
 */
const HostelMarketingPage = lazy(() =>
  import('@/features/hostel-drilldown/pages/HostelMarketingPage').then((m) => ({ default: m.HostelMarketingPage })),
);
const ListingPreviewPage = lazy(() => import('../pages/ListingPreviewPage').then((m) => ({ default: m.ListingPreviewPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

/**
 * StayO Platform Admin console route tree, per `Stayo Admin.dc.html`
 * (2026-08-16 rebuild). A desktop sidebar console gated by
 * `RequireAdminSession` — a real `ADMIN`-role session, see
 * docs/obsidian/Decisions.md ADR-030 for why this persona exists.
 *
 * Settlements and Reports & Bugs deliberately render honest empty states:
 * their backends are not yet designed. See the spec at
 * docs/superpowers/specs/2026-08-16-admin-console-rebuild-design.md.
 */
export function AdminRoutes() {
  return (
    <Route element={<AdminProviderShell />}>
      <Route element={<AdminConsoleShell />}>
        <Route path="/admin" element={<OverviewPage />} />
        <Route path="/admin/leads" element={<LeadsPage />} />
        <Route path="/admin/owners" element={<OwnersPage />} />
        {/* Listing approval gates whether a hostel is discoverable; the
            marketing-content review (ADR-076) is a tab inside it rather than
            a separate destination — a listing needs both to go live. */}
        <Route path="/admin/kyc" element={<KycPage />} />
        <Route path="/admin/listings" element={<ListingsPage />} />
        {/* Full-screen: it renders the real Discovery listing, so it must not
            sit inside the console chrome. */}
        <Route path="/admin/listings/preview/:revisionId" element={<ListingPreviewPage />} />
        <Route path="/admin/listings/:hostelId/edit" element={<HostelMarketingPage />} />
        <Route path="/admin/revenue" element={<RevenuePage />} />
        <Route path="/admin/settlements" element={<SettlementsPage />} />
        <Route path="/admin/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/admin/broadcasts" element={<BroadcastsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />

        {/* Old paths, kept so existing links and bookmarks do not rot. */}
        <Route path="/admin/documents" element={<Navigate to="/admin/kyc" replace />} />
        <Route path="/admin/hostels" element={<Navigate to="/admin/listings" replace />} />
        <Route path="/admin/marketing-reviews" element={<Navigate to="/admin/listings?tab=content" replace />} />
        <Route path="/admin/more" element={<Navigate to="/admin/settings" replace />} />
        {/* Support tickets landed on main while this console was being rebuilt.
            They are exactly what the design's Reports & Bugs section is for, so
            that screen now serves them and the old path redirects here. */}
        <Route path="/admin/support-tickets" element={<Navigate to="/admin/reports" replace />} />
      </Route>
    </Route>
  );
}
