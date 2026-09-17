import { lazy } from 'react';
import { Navigate, Route } from 'react-router-dom';
import { AdminHomeDispatch } from './AdminHomeDispatch';
import { RequireAdminOnly } from './RequireAdminOnly';

const AdminConsoleShell = lazy(() =>
  import('../layout/AdminConsoleShell').then((m) => ({ default: m.AdminConsoleShell })),
);
const AdminProviderShell = lazy(() =>
  import('./AdminProviderShell').then((m) => ({ default: m.AdminProviderShell })),
);

const OverviewPage = lazy(() => import('../pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const ManagerDashboardPage = lazy(() => import('../pages/ManagerDashboardPage').then((m) => ({ default: m.ManagerDashboardPage })));
const ManagersPage = lazy(() => import('../pages/ManagersPage').then((m) => ({ default: m.ManagersPage })));
const ActivityPage = lazy(() => import('../pages/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const OnboardingMonitorPage = lazy(() => import('../pages/OnboardingMonitorPage').then((m) => ({ default: m.OnboardingMonitorPage })));
const ManagerHostelDetailPage = lazy(() => import('../pages/ManagerHostelDetailPage').then((m) => ({ default: m.ManagerHostelDetailPage })));
const LeadsPage = lazy(() => import('../pages/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const OwnersPage = lazy(() => import('../pages/OwnersPage').then((m) => ({ default: m.OwnersPage })));
const ListingsPage = lazy(() => import('../pages/ListingsPage').then((m) => ({ default: m.ListingsPage })));
const ReviewsPage = lazy(() => import('../pages/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const RevenuePage = lazy(() => import('../pages/RevenuePage').then((m) => ({ default: m.RevenuePage })));
const SubscriptionsPage = lazy(() => import('../pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })));
const ReportsPage = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const BroadcastsPage = lazy(() => import('../pages/BroadcastsPage').then((m) => ({ default: m.BroadcastsPage })));
/**
 * The owner's marketing editor, reused verbatim (wrapped in admin desktop
 * chrome by `AdminListingEditorPage` — a back button, hostel context, and a
 * centered phone-width frame; the editor itself is untouched). Stayo's team
 * authors and manages listing pages for any hostel — including ones an owner
 * already runs — so the admin console mounts the same component rather than
 * growing a second editor that would drift from it.
 */
const AdminListingEditorPage = lazy(() =>
  import('../pages/AdminListingEditorPage').then((m) => ({ default: m.AdminListingEditorPage })),
);
const ListingPreviewPage = lazy(() => import('../pages/ListingPreviewPage').then((m) => ({ default: m.ListingPreviewPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

/**
 * StayO Platform Admin console route tree, per `Stayo Admin.dc.html`
 * (2026-08-16 rebuild). A desktop sidebar console gated by
 * `RequireAdminSession` — a real `ADMIN`-role session, see
 * docs/obsidian/Decisions.md ADR-030 for why this persona exists.
 *
 * Reports & Bugs deliberately renders an honest empty state where its
 * backend is not yet designed. See the spec at
 * docs/superpowers/specs/2026-08-16-admin-console-rebuild-design.md.
 *
 * Settlements (owner-payout run/lanes UI) was removed from this console
 * entirely — see docs/obsidian/Changelog.md. The shared owner-payout
 * backend it never touched (`owner-payouts` services, `/api/owner/payouts/*`)
 * is untouched and still serves the owner app.
 *
 * KYC Approvals (the owner-document review queue) was also removed. Its
 * backend (`/api/platform-admin/owner-documents*`, the admin-only review
 * route) is gone with it; the owner-facing upload flow
 * (`/api/owner/kyc-documents`, `document-vault-service.ts`) never depended
 * on it and is untouched.
 */
export function AdminRoutes() {
  return (
    <Route element={<AdminProviderShell />}>
      <Route element={<AdminConsoleShell />}>
        {/* ADR-212: a MANAGER session sees its own scoped dashboard; ADMIN sees the platform-wide Overview. Backend-enforced regardless — see AdminHomeDispatch. */}
        <Route path="/admin" element={<AdminHomeDispatch admin={<OverviewPage />} manager={<ManagerDashboardPage />} />} />
        <Route path="/admin/leads" element={<LeadsPage />} />
        <Route path="/admin/owners" element={<OwnersPage />} />
        <Route path="/admin/managers" element={<RequireAdminOnly><ManagersPage /></RequireAdminOnly>} />
        <Route path="/admin/activity" element={<RequireAdminOnly><ActivityPage /></RequireAdminOnly>} />
        <Route path="/admin/onboarding" element={<OnboardingMonitorPage />} />
        <Route path="/admin/hostels/:hostelId" element={<ManagerHostelDetailPage />} />
        {/* Listing approval gates whether a hostel is discoverable; the
            marketing-content review (ADR-076) is a tab inside it rather than
            a separate destination — a listing needs both to go live. */}
        <Route path="/admin/listings" element={<ListingsPage />} />
        <Route path="/admin/reviews" element={<ReviewsPage />} />
        {/* Full-screen: it renders the real Discovery listing, so it must not
            sit inside the console chrome. */}
        <Route path="/admin/listings/preview/:revisionId" element={<ListingPreviewPage />} />
        <Route path="/admin/listings/:hostelId/edit" element={<AdminListingEditorPage />} />
        <Route path="/admin/revenue" element={<RevenuePage />} />
        <Route path="/admin/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/admin/broadcasts" element={<BroadcastsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />

        {/* Old paths, kept so existing links and bookmarks do not rot. */}
        <Route path="/admin/hostels" element={<Navigate to="/admin/listings" replace />} />
        <Route path="/admin/marketing-reviews" element={<Navigate to="/admin/listings?tab=content" replace />} />
        {/* Settlements — removed from the Admin Console. */}
        <Route path="/admin/settlements" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/settlements/*" element={<Navigate to="/admin" replace />} />
        {/* KYC Approvals — removed from the Admin Console. */}
        <Route path="/admin/kyc" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/documents" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/more" element={<Navigate to="/admin/settings" replace />} />
        {/* Support tickets landed on main while this console was being rebuilt.
            They are exactly what the design's Reports & Bugs section is for, so
            that screen now serves them and the old path redirects here. */}
        <Route path="/admin/support-tickets" element={<Navigate to="/admin/reports" replace />} />
      </Route>
    </Route>
  );
}
