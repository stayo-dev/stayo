import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Outlet, Route, useParams } from 'react-router-dom';
import { queryClient } from '@lib/queryClient';
import { AuthProvider } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { resolveHomepageVersion } from '@/app/pages/public/homepageVersion';

const WelcomePage = lazy(() => import('@/app/pages/public/WelcomePage').then((m) => ({ default: m.WelcomePage })));
const HomePage = lazy(() => import('@/app/pages/public/HomePage').then((m) => ({ default: m.HomePage })));
const LandingPage = lazy(() => import('@/app/pages/public/LandingPage').then((m) => ({ default: m.LandingPage })));
const LeadSignupCallbackPage = lazy(() => import('@/app/pages/public/LeadSignupCallbackPage').then((m) => ({ default: m.LeadSignupCallbackPage })));
const OwnerActivationPage = lazy(() => import('@/app/pages/public/OwnerActivationPage').then((m) => ({ default: m.OwnerActivationPage })));
const ManagerActivationPage = lazy(() => import('@/app/pages/public/ManagerActivationPage').then((m) => ({ default: m.ManagerActivationPage })));
const EnquiryStatusPage = lazy(() => import('@/app/pages/public/EnquiryStatusPage').then((m) => ({ default: m.EnquiryStatusPage })));
// Marketplace partner surfaces — a hostel owner with no Stayo account, reached
// only from the stayo_partner_* WhatsApp templates. See ADR-231.
const PartnerPortalPage = lazy(() => import('@/app/pages/public/PartnerPortalPage').then((m) => ({ default: m.PartnerPortalPage })));
const PartnerEnquiryPage = lazy(() => import('@/app/pages/public/PartnerEnquiryPage').then((m) => ({ default: m.PartnerEnquiryPage })));
const PartnerActivatePage = lazy(() => import('@/app/pages/public/PartnerActivatePage').then((m) => ({ default: m.PartnerActivatePage })));
const AboutPage = lazy(() => import('@/app/pages/public/AboutPage').then((m) => ({ default: m.AboutPage })));
const CompanyPage = lazy(() => import('@/app/pages/public/CompanyPage').then((m) => ({ default: m.CompanyPage })));
const ContactPage = lazy(() => import('@/app/pages/public/ContactPage').then((m) => ({ default: m.ContactPage })));
const LegalPage = lazy(() => import('@/app/pages/LegalPage').then((m) => ({ default: m.LegalPage })));
const VisitPage = lazy(() => import('@/app/pages/public/VisitPage').then((m) => ({ default: m.VisitPage })));
const AuthCallbackPage = lazy(() => import('@/app/pages/AuthCallbackPage').then((m) => ({ default: m.AuthCallbackPage })));
const ForgotPasswordPage = lazy(() => import('@/app/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/app/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const ActivationPage = lazy(() => import('@/platforms/tenant/onboarding/ActivationPage').then((m) => ({ default: m.ActivationPage })));
const AgreementReaderPage = lazy(() => import('@/platforms/tenant/onboarding/AgreementReaderPage').then((m) => ({ default: m.AgreementReaderPage })));
const CompleteProfilePage = lazy(() => import('@/portal/pages/CompleteProfilePage').then((m) => ({ default: m.CompleteProfilePage })));
const AuthRouteShell = lazy(() => import('@/app/providers/AuthRouteShell').then((m) => ({ default: m.AuthRouteShell })));
const ReceiptVerificationPage = lazy(() => import('@/app/pages/public/ReceiptVerificationPage').then((m) => ({ default: m.ReceiptVerificationPage })));
const ClerkSignInPage = lazy(() => import('@/app/pages/auth/ClerkSignInPage').then((m) => ({ default: m.ClerkSignInPage })));
const ClerkSignUpPage = lazy(() => import('@/app/pages/auth/ClerkSignUpPage').then((m) => ({ default: m.ClerkSignUpPage })));

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

/**
 * `stayo_admin_invitation` and `stayo_admin_invitation_reminder` were approved
 * in Meta on 2026-09-21 with their URL button hard-coded to
 * `https://yourstayo.com/admin/activate/{{1}}`, while this app serves the
 * manager activation screen at `/admin/manager-invitation/:token`.
 *
 * Editing an approved template re-triggers Meta review and would strand every
 * invitation already delivered, so the path is served here instead. Same
 * reasoning as `OwnerInviteRedirect` above.
 */
function ManagerInviteTemplateRedirect() {
  const { token } = useParams<{ token: string }>();
  return <Navigate to={token ? `/admin/manager-invitation/${token}` : '/login'} replace />;
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

/**
 * Whichever front door `/` is configured to serve.
 *
 * Read once per render from the environment and the live query string, so
 * `?homepage=chooser` works on a deployed build without a redeploy.
 */
function RootHomepage() {
  const version = resolveHomepageVersion({
    envValue: import.meta.env.VITE_HOMEPAGE,
    search: typeof window === 'undefined' ? '' : window.location.search,
  });
  return version === 'chooser' ? <WelcomePage /> : <HomePage />;
}

export function PublicRoutes() {
  return (
    <>
      {/* ── Public hostel landing pages (SEO crawlable) ──────────────── */}
      <Route element={<PublicShell />}>
        {/* ADR-223: `/` serves the student-first homepage, and ADR-071's
            audience chooser is kept beside it rather than deleted. Which one
            `/` renders is decided by `resolveHomepageVersion` — a query
            parameter for previewing, else VITE_HOMEPAGE, else the default —
            so switching back is a config change, not a revert.

            Both also keep permanent URLs of their own, so a bad flag value can
            never make either unreachable. `/owners` is untouched by all of
            this: it is still the owner marketing page and still where every
            owner CTA and route guard points. */}
        <Route path="/" element={<RootHomepage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/home-v2" element={<HomePage />} />
        <Route path="/owners" element={<LandingPage />} />
        {/* ADR-035: one login surface. `/login` is the landing page with the
            Stayo login popup already open — kept as a real URL because
            session expiry, the admin guard, password reset and tenant
            activation all need somewhere to redirect to. Lives here rather
            than under AuthShell because the popup needs AuthProvider. */}
        <Route path="/login" element={<LandingPage />} />
        {/* ADR-176 Phase 2: Clerk's own sign-in/sign-up, public like `/login`.
            The `/*` splat is required — `<SignIn routing="path">` renders its
            sub-steps (email-code entry, SSO callback, session tasks) as child
            paths, and without it they 404. These are additive: `/login` remains
            the live Supabase surface, and completing a Clerk sign-in does not
            yet authorise anything (see lib/auth/sessionAuthority.ts). */}
        <Route path="/sign-in/*" element={<ClerkSignInPage />} />
        <Route path="/sign-up/*" element={<ClerkSignUpPage />} />
        <Route path="/lead-signup/callback" element={<LeadSignupCallbackPage />} />
        <Route path="/activation/:token" element={<OwnerActivationPage />} />
        <Route path="/admin/manager-invitation/:token" element={<ManagerActivationPage />} />
        <Route path="/admin/activate/:token" element={<ManagerInviteTemplateRedirect />} />
        <Route path="/owner-invite/:token" element={<OwnerInviteRedirect />} />
        <Route path="/enquiry/:token" element={<EnquiryStatusPage />} />
        {/*
          * Order matters: the literal segments must precede the catch-all
          * `:token`, or a partner opening an enquiry link would land on the
          * portal with "enquiry" read as their token.
          */}
        <Route path="/partner/enquiry/:token" element={<PartnerEnquiryPage />} />
        <Route path="/partner/activate/:token" element={<PartnerActivatePage />} />
        <Route path="/partner/:token" element={<PartnerPortalPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/contact" element={<ContactPage />} />
        {/*
          * Legal documents. Every canonical route AND every older URL is listed
          * literally: payment aggregators and Meta may have registered the old
          * ones. src/content/legal/routes.test.ts fails if the registry declares
          * a path this table does not serve. /contact stays on ContactPage
          * until Phase 3; the contact document renders at /legal/contact.
          */}
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/legal/terms" element={<LegalPage />} />
        <Route path="/terms" element={<LegalPage />} />
        <Route path="/legal/privacy" element={<LegalPage />} />
        <Route path="/privacy" element={<LegalPage />} />
        <Route path="/legal/refunds" element={<LegalPage />} />
        <Route path="/legal/refund-policy" element={<LegalPage />} />
        <Route path="/refund-policy" element={<LegalPage />} />
        <Route path="/legal/cookies" element={<LegalPage />} />
        <Route path="/legal/service-delivery" element={<LegalPage />} />
        <Route path="/legal/shipping-policy" element={<LegalPage />} />
        <Route path="/shipping-policy" element={<LegalPage />} />
        <Route path="/legal/data-deletion" element={<LegalPage />} />
        <Route path="/legal/contact" element={<LegalPage />} />
        <Route path="/visit/:hostelSlug" element={<VisitPage />} />
        <Route path="/verify/r/:token" element={<ReceiptVerificationPage />} />
      </Route>

      {/* ── Auth & utility ───────────────────────────────────────────── */}
      <Route element={<AuthShell />}>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/activate" element={<ActivationPage />} />
        {/*
          Declared before `/activate/:token`, and safe regardless: React Router
          ranks a static segment above a dynamic one, so "agreement" is never
          mistaken for an activation token.
        */}
        <Route path="/activate/agreement" element={<AgreementReaderPage />} />
        <Route path="/activate/:token" element={<ActivationPage />} />
        <Route path="/invite/:token" element={<ActivationPage />} />
        <Route path="/complete-profile" element={<CompleteProfilePage />} />
      </Route>
    </>
  );
}
