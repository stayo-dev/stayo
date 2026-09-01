import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Outlet, Route, useParams } from 'react-router-dom';
import { queryClient } from '@lib/queryClient';
import { AuthProvider } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

const WelcomePage = lazy(() => import('@/app/pages/public/WelcomePage').then((m) => ({ default: m.WelcomePage })));
const LandingPage = lazy(() => import('@/app/pages/public/LandingPage').then((m) => ({ default: m.LandingPage })));
const LeadSignupCallbackPage = lazy(() => import('@/app/pages/public/LeadSignupCallbackPage').then((m) => ({ default: m.LeadSignupCallbackPage })));
const OwnerActivationPage = lazy(() => import('@/app/pages/public/OwnerActivationPage').then((m) => ({ default: m.OwnerActivationPage })));
const EnquiryStatusPage = lazy(() => import('@/app/pages/public/EnquiryStatusPage').then((m) => ({ default: m.EnquiryStatusPage })));
const AboutPage = lazy(() => import('@/app/pages/public/AboutPage').then((m) => ({ default: m.AboutPage })));
const CompanyPage = lazy(() => import('@/app/pages/public/CompanyPage').then((m) => ({ default: m.CompanyPage })));
const ContactPage = lazy(() => import('@/app/pages/public/ContactPage').then((m) => ({ default: m.ContactPage })));
const LegalPage = lazy(() => import('@/app/pages/LegalPage').then((m) => ({ default: m.LegalPage })));
const VisitPage = lazy(() => import('@/app/pages/public/VisitPage').then((m) => ({ default: m.VisitPage })));
const AuthCallbackPage = lazy(() => import('@/app/pages/AuthCallbackPage').then((m) => ({ default: m.AuthCallbackPage })));
const ForgotPasswordPage = lazy(() => import('@/app/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/app/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const ActivationPage = lazy(() => import('@/platforms/tenant/onboarding/ActivationPage').then((m) => ({ default: m.ActivationPage })));
const CompleteProfilePage = lazy(() => import('@/portal/pages/CompleteProfilePage').then((m) => ({ default: m.CompleteProfilePage })));
const AuthRouteShell = lazy(() => import('@/app/providers/AuthRouteShell').then((m) => ({ default: m.AuthRouteShell })));
const ReceiptVerificationPage = lazy(() => import('@/app/pages/public/ReceiptVerificationPage').then((m) => ({ default: m.ReceiptVerificationPage })));

/**
 * Public pages are full-screen takeovers with no persistent chrome, so there is
 * no layout to skeleton — and this is the boundary the very first paint of `/`
 * lands on, straight after index.html's boot splash. Showing the same brand
 * loading screen there makes the boot → landing hand-off one continuous
 * surface. (It used to be a bare slate-50 rectangle, which was both blank and
 * off-palette.)
 */
function PublicRouteFallback() {
  return <StayoLoadingScreen />;
}

/**
 * `/owner-invite/:token` was the activation link's path before it was
 * renamed to `/activation/:token` (2026-08-31). Any invitation approved and
 * sent over WhatsApp/email before that rename shipped has the old path
 * baked into already-delivered message text, permanently — nothing
 * server-side can rewrite a message that already went out. This keeps
 * those still-unexpired, unactivated links working indefinitely instead of
 * 404ing on a token that is otherwise perfectly valid.
 */
function OwnerInviteRedirect() {
  const { token } = useParams<{ token: string }>();
  return <Navigate to={token ? `/activation/${token}` : '/activation'} replace />;
}

function PublicShell() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* LandingPage reads useOwnerSession() (returning-owner CTA), which needs
          AuthProvider — added here rather than pulling in the full protected
          shell, to keep public pages light. */}
      <AuthProvider>
        <Suspense fallback={<PublicRouteFallback />}>
          <Outlet />
        </Suspense>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthShell() {
  return (
    <Suspense fallback={<PublicRouteFallback />}>
      <AuthRouteShell />
    </Suspense>
  );
}

export function PublicRoutes() {
  return (
    <>
      {/* ── Public hostel landing pages (SEO crawlable) ──────────────── */}
      <Route element={<PublicShell />}>
        {/* ADR-071: `/` asks which audience you are before it pitches at you.
            The owner marketing page it used to hold now lives at `/owners`,
            which is where "Start free" hands off to. Every other route that
            means "the owner home" points at `/owners` too — `/` is a fork,
            not a destination, so landing a signed-out owner there after a
            session expiry or a logo click would have been a step backwards. */}
        <Route path="/" element={<WelcomePage />} />
        <Route path="/owners" element={<LandingPage />} />
        {/* ADR-035: one login surface. `/login` is the landing page with the
            Stayo login popup already open — kept as a real URL because
            session expiry, the admin guard, password reset and tenant
            activation all need somewhere to redirect to. Lives here rather
            than under AuthShell because the popup needs AuthProvider. */}
        <Route path="/login" element={<LandingPage />} />
        <Route path="/lead-signup/callback" element={<LeadSignupCallbackPage />} />
        <Route path="/activation/:token" element={<OwnerActivationPage />} />
        <Route path="/owner-invite/:token" element={<OwnerInviteRedirect />} />
        <Route path="/enquiry/:token" element={<EnquiryStatusPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/legal/terms" element={<LegalPage />} />
        <Route path="/legal/privacy" element={<LegalPage />} />
        <Route path="/legal/refund-policy" element={<LegalPage />} />
        <Route path="/legal/shipping-policy" element={<LegalPage />} />
        <Route path="/legal/contact" element={<LegalPage />} />
        <Route path="/legal/data-deletion" element={<LegalPage />} />
        <Route path="/terms" element={<LegalPage />} />
        <Route path="/privacy" element={<LegalPage />} />
        <Route path="/shipping-policy" element={<LegalPage />} />
        <Route path="/refund-policy" element={<LegalPage />} />
        <Route path="/visit/:hostelSlug" element={<VisitPage />} />
        <Route path="/verify/r/:token" element={<ReceiptVerificationPage />} />
      </Route>

      {/* ── Auth & utility ───────────────────────────────────────────── */}
      <Route element={<AuthShell />}>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/activate" element={<ActivationPage />} />
        <Route path="/activate/:token" element={<ActivationPage />} />
        <Route path="/invite/:token" element={<ActivationPage />} />
        <Route path="/complete-profile" element={<CompleteProfilePage />} />
      </Route>
    </>
  );
}
