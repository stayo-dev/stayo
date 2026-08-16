import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet, Route } from 'react-router-dom';

import { queryClient } from '@lib/queryClient';
import { AuthProvider } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

import { AppShell } from '@/app/layouts/AppShell';
import { DiscoverAuthProvider } from '@/app/pages/discover/DiscoverAuthContext';
import { ProfileRoutes } from './ProfileRoutes';

const ExplorePage = lazy(() => import('@/app/pages/discover/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const SearchPage = lazy(() => import('@/app/pages/discover/SearchPage').then((m) => ({ default: m.SearchPage })));
const ListingPage = lazy(() => import('@/app/pages/discover/ListingPage').then((m) => ({ default: m.ListingPage })));
const EnquiryPage = lazy(() => import('@/app/pages/discover/EnquiryPage').then((m) => ({ default: m.EnquiryPage })));

/**
 * Stayo Discover — the public marketplace (ADR-073).
 *
 * Its own shell rather than a tab inside `/tenant/*`, for one reason that
 * decides it: almost everyone using Discover has no tenancy. Putting it behind
 * the tenant portal's guard would force a sign-in before browsing, which kills
 * both SEO and the top of the funnel.
 *
 * There is deliberately **no route guard here.** Explore, search and listing
 * detail are public; Saved, Enquiries and Profile are authenticated *content*,
 * and each renders `SignedOutPrompt` rather than redirecting — bouncing
 * someone to `/login` the moment they tap a tab loses the place they were in.
 * The server is the real boundary: every `/api/discover` route except the
 * browse endpoints requires a session (see `requireSeeker`).
 */
function DiscoverProviderShell() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Discover reads the session to decide between the seeker view and the
          signed-out prompt, so it needs AuthProvider — but not the full
          protected shell, which would pull in owner dashboard bootstrap. */}
      <AuthProvider>
        {/* Sign-in happens *here*, over whatever screen the visitor is on —
            not by routing to `/login`, which is the owner marketing page.
            Same LoginModal component, so there is still one auth surface. */}
        <DiscoverAuthProvider>
          <AppShell>
            <Suspense fallback={<StayoLoadingScreen />}>
              <Outlet />
            </Suspense>
          </AppShell>
        </DiscoverAuthProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export function DiscoverRoutes() {
  return (
    <Route element={<DiscoverProviderShell />}>
      <Route path="/discover" element={<ExplorePage />} />
      <Route path="/discover/search" element={<SearchPage />} />
      <Route path="/discover/h/:slug" element={<ListingPage />} />
      <Route path="/discover/h/:slug/enquire" element={<EnquiryPage />} />
      {/* Saved/Enquiries/Profile moved to `/profile/*` — the common Stayo
          Profile is a shared, app-wide tab now, not Discover-specific. */}
      {ProfileRoutes()}
    </Route>
  );
}
