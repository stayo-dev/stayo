import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet, Route } from 'react-router-dom';

import { queryClient } from '@lib/queryClient';
import { AuthProvider } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

import { DiscoverShell } from '@/app/pages/discover/components/DiscoverShell';
import { DiscoverAuthProvider } from '@/app/pages/discover/DiscoverAuthContext';

const ExplorePage = lazy(() => import('@/app/pages/discover/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const SearchPage = lazy(() => import('@/app/pages/discover/SearchPage').then((m) => ({ default: m.SearchPage })));
const ListingPage = lazy(() => import('@/app/pages/discover/ListingPage').then((m) => ({ default: m.ListingPage })));
const EnquiryPage = lazy(() => import('@/app/pages/discover/EnquiryPage').then((m) => ({ default: m.EnquiryPage })));
const EnquiriesPage = lazy(() => import('@/app/pages/discover/EnquiriesPage').then((m) => ({ default: m.EnquiriesPage })));
const EnquiryDetailPage = lazy(() =>
  import('@/app/pages/discover/EnquiryDetailPage').then((m) => ({ default: m.EnquiryDetailPage })),
);
const SavedPage = lazy(() => import('@/app/pages/discover/SavedPage').then((m) => ({ default: m.SavedPage })));
const DiscoverProfilePage = lazy(() =>
  import('@/app/pages/discover/DiscoverProfilePage').then((m) => ({ default: m.DiscoverProfilePage })),
);
const ProfileEditPage = lazy(() =>
  import('@/app/pages/discover/ProfileEditPage').then((m) => ({ default: m.ProfileEditPage })),
);
const ResidencyHistoryPage = lazy(() =>
  import('@/app/pages/discover/ResidencyHistoryPage').then((m) => ({ default: m.ResidencyHistoryPage })),
);

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
          <DiscoverShell>
            <Suspense fallback={<StayoLoadingScreen />}>
              <Outlet />
            </Suspense>
          </DiscoverShell>
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
      <Route path="/discover/saved" element={<SavedPage />} />
      <Route path="/discover/enquiries" element={<EnquiriesPage />} />
      <Route path="/discover/enquiries/:id" element={<EnquiryDetailPage />} />
      <Route path="/discover/profile" element={<DiscoverProfilePage />} />
      {/* The portable profile's editor (phase B). Deliberately reachable with
          no hostel involved — a tenant fills this in before enquiring. */}
      <Route path="/discover/profile/details" element={<ProfileEditPage />} />
      {/* The tenant's own stay history, and their control over who reads it —
          both on one screen, because a record without visibility of its
          readers erodes trust rather than building it. */}
      <Route path="/discover/profile/history" element={<ResidencyHistoryPage />} />
    </Route>
  );
}
