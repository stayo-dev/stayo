import { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminAppShell = lazy(() => import('@/app/layouts/AdminAppShell').then((m) => ({ default: m.AdminAppShell })));
const AdminProviderShell = lazy(() =>
  import('./AdminProviderShell').then((m) => ({ default: m.AdminProviderShell })),
);
const AdminHostelsPage = lazy(() => import('../pages/AdminHostelsPage').then((m) => ({ default: m.AdminHostelsPage })));
const AdminOwnersPage = lazy(() => import('../pages/AdminOwnersPage').then((m) => ({ default: m.AdminOwnersPage })));
const AdminLeadsPage = lazy(() => import('../pages/AdminLeadsPage').then((m) => ({ default: m.AdminLeadsPage })));
const AdminMarketingReviewsPage = lazy(() =>
  import('@/platforms/admin/pages/AdminMarketingReviewsPage').then((m) => ({ default: m.AdminMarketingReviewsPage })),
);
const AdminDocumentsPage = lazy(() => import('../pages/AdminDocumentsPage').then((m) => ({ default: m.AdminDocumentsPage })));
const AdminRevenuePage = lazy(() => import('../pages/AdminRevenuePage').then((m) => ({ default: m.AdminRevenuePage })));
const AdminDashboardPage = lazy(() => import('../pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const AdminMorePage = lazy(() => import('../pages/AdminMorePage').then((m) => ({ default: m.AdminMorePage })));
const AdminSettingsPage = lazy(() => import('../pages/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage })));

/**
 * StayO Platform Admin console route tree, per `Stayo Admin Dashboard/Stayo
 * Admin.dc.html` — a desktop sidebar console (Dashboard/Hostels/Leads/
 * Revenue/More/Settings), gated by `RequireAdminSession` (a real `ADMIN`-role
 * session — see docs/obsidian/Decisions.md ADR-030 for why this persona
 * exists at all). All screens real as of 2026-07-26.
 */
export function AdminRoutes() {
  return (
    <Route element={<AdminProviderShell />}>
      <Route element={<AdminAppShell />}>
        <Route path="/admin" element={<AdminDashboardPage />} />
        {/* Owners is the primary list; a hostel is a child of an owner.
            Hostels stays routable so owner cards can deep-link into it. */}
        <Route path="/admin/owners" element={<AdminOwnersPage />} />
        <Route path="/admin/hostels" element={<AdminHostelsPage />} />
        <Route path="/admin/leads" element={<AdminLeadsPage />} />
        {/* Listing content waiting on a human — see ADR-076. Separate from
            /admin/hostels, which gates whether a hostel is discoverable at
            all; a listing needs both. */}
        <Route path="/admin/marketing-reviews" element={<AdminMarketingReviewsPage />} />
        <Route path="/admin/documents" element={<AdminDocumentsPage />} />
        <Route path="/admin/revenue" element={<AdminRevenuePage />} />
        <Route path="/admin/more" element={<AdminMorePage />} />
        <Route path="/admin/settings" element={<AdminSettingsPage />} />
      </Route>
    </Route>
  );
}
