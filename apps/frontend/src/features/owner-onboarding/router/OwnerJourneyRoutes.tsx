import { lazy, Suspense } from 'react';
import { Outlet, Route } from 'react-router-dom';
import { Toaster } from '@/app/components/ui/sonner';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { AuthProvider } from '@context/AuthContext';
import { RequireMockOwnerJourney } from './RequireMockOwnerJourney';
import { StayoLoadingScreen } from '@shared/ui/brand';

const LeadSubmittedPage = lazy(() => import('../pages/LeadSubmittedPage').then((m) => ({ default: m.LeadSubmittedPage })));
const ActivationLinkPage = lazy(() => import('../pages/ActivationLinkPage').then((m) => ({ default: m.ActivationLinkPage })));
const OwnerOnboardingWizard = lazy(() => import('../pages/OwnerOnboardingWizard').then((m) => ({ default: m.OwnerOnboardingWizard })));

/** Journey screens are full-screen takeovers — nothing is mounted underneath. */
function JourneyRouteFallback() {
  return <StayoLoadingScreen />;
}

/**
 * Mounts the sonner Toaster for the mock journey's own screens (used by the
 * onboarding wizard's "Save draft" toast). `MockOwnerJourneyProvider` itself
 * is mounted higher up, in AppRouter — the Landing page at `/` (under
 * PublicRoutes) also needs to read/write this session, so the provider has
 * to wrap both route trees, not just this one.
 */
function OwnerJourneyBoundary() {
  return (
    <ErrorBoundary context="owner-journey-routes">
      {/* AuthProvider — the onboarding wizard's account step does a real
          sign-up + login (useOnboardingSubmission), which needs it. Not
          mounted this far up the tree otherwise. */}
      <AuthProvider>
        <Toaster position="top-right" expand visibleToasts={4} closeButton richColors />
        <Suspense fallback={<JourneyRouteFallback />}>
          <Outlet />
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}

/** Lead Submitted / Activation / the onboarding wizard all use the marketing token set, per their design source. */
function MarketingThemeBoundary() {
  return (
    <ThemeProvider theme="marketing">
      <Outlet />
    </ThemeProvider>
  );
}

/**
 * Routes for the owner acquisition/lead-capture funnel (Landing lives at
 * `/`, under PublicRoutes — everything downstream of the Google-mock step
 * lives here) plus the real onboarding wizard. `/onboarding` itself does
 * real sign-up/login mid-wizard (its account step), so it isn't gated on
 * entry, and on success now lands the owner on `/owner/home` — the single
 * canonical owner app (see `platforms/owner/router/OwnerRoutes.tsx`). The
 * two lead-capture pages (`/get-started/submitted`, `/get-started/activate/:token`)
 * remain mock/local-state only, gated by `RequireMockOwnerJourney` — real
 * lead persistence + admin review is a later phase, not part of this app's
 * real-data wiring yet.
 */
export function OwnerJourneyRoutes() {
  return (
    <Route element={<OwnerJourneyBoundary />}>
      <Route element={<MarketingThemeBoundary />}>
        <Route element={<RequireMockOwnerJourney require="authenticated" />}>
          <Route path="/get-started/submitted" element={<LeadSubmittedPage />} />
          <Route path="/get-started/activate/:token" element={<ActivationLinkPage />} />
        </Route>
        {/* No auth gate here — the wizard's own account step is where real
            sign-up/login happens; the visitor isn't authenticated yet on entry. */}
        <Route path="/onboarding" element={<OwnerOnboardingWizard />} />
      </Route>
    </Route>
  );
}
