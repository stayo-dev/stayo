import { lazy } from 'react';
import { Route } from 'react-router-dom';

import { ProfileRoutes } from './ProfileRoutes';

const ExplorePage = lazy(() => import('@/app/pages/discover/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const SearchPage = lazy(() => import('@/app/pages/discover/SearchPage').then((m) => ({ default: m.SearchPage })));
const ListingPage = lazy(() => import('@/app/pages/discover/ListingPage').then((m) => ({ default: m.ListingPage })));
const EnquiryPage = lazy(() => import('@/app/pages/discover/EnquiryPage').then((m) => ({ default: m.EnquiryPage })));
const ReviewsPage = lazy(() => import('@/app/pages/discover/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));

/**
 * Stayo Discover — the public marketplace (ADR-073).
 *
 * ⚠️ UNMOUNTED FOR v1 (ADR-170). This function is no longer called from
 * `AppRouter.tsx` — the marketplace is shelved until v2. The file, its page
 * components (`src/app/pages/discover/*`) and its feature layer
 * (`src/features/discover/*`) are all kept intact on disk; reviving is a
 * matter of re-registering this tree and flipping the backend's
 * `MARKETPLACE_ENABLED` flag. `ProfileRoutes()` (the shared Profile hub that
 * this used to nest) is now mounted directly in `AppRouter.tsx`.
 *
 * Almost everyone using Discover has no tenancy, so there is deliberately
 * **no route guard here.** Explore, search and listing detail are public;
 * Saved, Enquiries and Profile are authenticated *content*, and each renders
 * `SignedOutPrompt` rather than redirecting — bouncing someone to `/login`
 * the moment they tap a tab loses the place they were in. The server is the
 * real boundary: every `/api/discover` route except the browse endpoints
 * requires a session (see `requireSeeker`).
 *
 * These routes (plus `ProfileRoutes()`) are nested under the shared
 * `SeekerAppShell` in `AppRouter.tsx` — alongside `TenantRoutes()` — rather
 * than owning their own provider shell, so Explore/Profile and the Tenant
 * Dashboard share one `QueryClientProvider`/`AuthProvider`/`AppShell`
 * instance instead of each remounting the other's on every crossing.
 */
export function DiscoverRoutes() {
  return (
    <>
      <Route path="/discover" element={<ExplorePage />} />
      <Route path="/discover/search" element={<SearchPage />} />
      <Route path="/discover/h/:slug" element={<ListingPage />} />
      <Route path="/discover/h/:slug/enquire" element={<EnquiryPage />} />
      <Route path="/discover/h/:slug/reviews" element={<ReviewsPage />} />
      {/* Saved/Enquiries/Profile moved to `/profile/*` — the common Stayo
          Profile is a shared, app-wide tab now, not Discover-specific. */}
      {ProfileRoutes()}
    </>
  );
}
