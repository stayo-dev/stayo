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
 * and `/tenant/profile`. Mounted as siblings inside the same
 * `DiscoverProviderShell` route element `DiscoverRoutes` uses, so Profile
 * shares Discover's lightweight `AuthProvider` + `DiscoverAuthProvider`
 * (in-place sign-in, no `/login` redirect) rather than standing up a second
 * provider tree.
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
      <Route path="/profile/saved" element={<SavedPage />} />
      <Route path="/profile/enquiries" element={<EnquiriesPage />} />
      <Route path="/profile/enquiries/:id" element={<EnquiryDetailPage />} />
    </>
  );
}
