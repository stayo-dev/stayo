import { lazy } from 'react';
import { Route } from 'react-router-dom';

const DiscoverProfilePage = lazy(() =>
  import('@/app/pages/discover/DiscoverProfilePage').then((m) => ({ default: m.DiscoverProfilePage })),
);
const ProfileEditPage = lazy(() =>
  import('@/app/pages/discover/ProfileEditPage').then((m) => ({ default: m.ProfileEditPage })),
);
const ResidencyHistoryPage = lazy(() =>
  import('@/app/pages/discover/ResidencyHistoryPage').then((m) => ({ default: m.ResidencyHistoryPage })),
);
const ProfileDocumentsPage = lazy(() =>
  import('@/app/pages/discover/ProfileDocumentsPage').then((m) => ({ default: m.ProfileDocumentsPage })),
);
const AlertsPage = lazy(() =>
  import('@features/tenant-alerts/AlertsPage').then((m) => ({ default: m.AlertsPage })),
);
const SupportTicketsPage = lazy(() =>
  import('@/app/pages/discover/SupportTicketsPage').then((m) => ({ default: m.SupportTicketsPage })),
);
const SavedPage = lazy(() => import('@/app/pages/discover/SavedPage').then((m) => ({ default: m.SavedPage })));
const EnquiriesPage = lazy(() =>
  import('@/app/pages/discover/EnquiriesPage').then((m) => ({ default: m.EnquiriesPage })),
);
const EnquiryDetailPage = lazy(() =>
  import('@/app/pages/discover/EnquiryDetailPage').then((m) => ({ default: m.EnquiryDetailPage })),
);

/**
 * The one common Stayo Profile route tree (ADR-074's portable profile,
 * promoted app-wide) — `/profile/*`, not duplicated under `/discover/profile`
 * and `/tenant/profile`. Mounted directly under the shared `SeekerAppShell`
 * (`AppRouter.tsx`) alongside `TenantRoutes` — so Profile shares one
 * `AuthProvider` + `DiscoverAuthProvider` (in-place sign-in, no `/login`
 * redirect) with the Tenant Dashboard, rather than standing up a second
 * provider tree. (Until v1's ADR-170 this was nested inside `DiscoverRoutes`;
 * the marketplace is shelved but this hub stayed.)
 *
 * Page components still live under `app/pages/discover/*` and are still
 * named for their Discover origin (`DiscoverProfilePage`, `ProfileEditPage`)
 * — the promotion/rename into `app/pages/profile/*` and the dissolution of
 * `TenantProfilePage` into these pages happens as its own change, not
 * bundled into this route-tree move.
 */
export function ProfileRoutes() {
  return (
    <>
      <Route path="/profile" element={<DiscoverProfilePage />} />
      <Route path="/profile/details" element={<ProfileEditPage />} />
      <Route path="/profile/history" element={<ResidencyHistoryPage />} />
      <Route path="/profile/documents" element={<ProfileDocumentsPage />} />
      <Route path="/profile/alerts" element={<AlertsPage />} />
      <Route path="/profile/tickets" element={<SupportTicketsPage />} />
      <Route path="/profile/saved" element={<SavedPage />} />
      <Route path="/profile/enquiries" element={<EnquiriesPage />} />
      <Route path="/profile/enquiries/:id" element={<EnquiryDetailPage />} />
    </>
  );
}
