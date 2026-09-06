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
const ReviewsPage = lazy(() => import('../pages/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const RevenuePage = lazy(() => import('../pages/RevenuePage').then((m) => ({ default: m.RevenuePage })));
const SettlementsPage = lazy(() => import('../pages/SettlementsPage').then((m) => ({ default: m.SettlementsPage })));
const SubscriptionsPage = lazy(() => import('../pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })));
const ReportsPage = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const BroadcastsPage = lazy(() => import('../pages/BroadcastsPage').then((m) => ({ default: m.BroadcastsPage })));
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
        <Route path="/admin/kyc" element={<KycPage />} />
        {/* Hostel Listings (the Stayo Discover marketplace admin — approval,
            marketing-content review, platform-authored listings) is shelved
            for v1 (ADR-170). Routes redirect to Overview; ListingsPage /
            ListingPreviewPage and their panels are kept on disk for v2.
            `/admin/reviews` (resident-review moderation) stays — it just has
            no new input while Discover is off. */}
        <Route path="/admin/reviews" element={<ReviewsPage />} />
        <Route path="/admin/revenue" element={<RevenuePage />} />
        <Route path="/admin/settlements" element={<SettlementsPage />} />
        <Route path="/admin/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/admin/broadcasts" element={<BroadcastsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />

        {/* Old paths, kept so existing links and bookmarks do not rot. */}
        <Route path="/admin/documents" element={<Navigate to="/admin/kyc" replace />} />
        {/* Marketplace admin — shelved for v1 (ADR-170). */}
        <Route path="/admin/hostels" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/listings/*" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/marketing-reviews" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/more" element={<Navigate to="/admin/settings" replace />} />
        {/* Support tickets landed on main while this console was being rebuilt.
            They are exactly what the design's Reports & Bugs section is for, so
            that screen now serves them and the old path redirects here. */}
        <Route path="/admin/support-tickets" element={<Navigate to="/admin/reports" replace />} />
      </Route>
    </Route>
  );
}
