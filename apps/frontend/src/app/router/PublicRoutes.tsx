import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet, Route } from 'react-router-dom';
import { queryClient } from '@lib/queryClient';
import { AuthProvider } from '@context/AuthContext';

const LandingPage = lazy(() => import('@/app/pages/public/LandingPage').then((m) => ({ default: m.LandingPage })));
const LeadSignupCallbackPage = lazy(() => import('@/app/pages/public/LeadSignupCallbackPage').then((m) => ({ default: m.LeadSignupCallbackPage })));
const OwnerLeadInvitePage = lazy(() => import('@/app/pages/public/OwnerLeadInvitePage').then((m) => ({ default: m.OwnerLeadInvitePage })));
const AboutPage = lazy(() => import('@/app/pages/public/AboutPage').then((m) => ({ default: m.AboutPage })));
const CompanyPage = lazy(() => import('@/app/pages/public/CompanyPage').then((m) => ({ default: m.CompanyPage })));
const FacilitiesPage = lazy(() => import('@/app/pages/public/FacilitiesPage').then((m) => ({ default: m.FacilitiesPage })));
const RoomsPage = lazy(() => import('@/app/pages/public/RoomsPage').then((m) => ({ default: m.RoomsPage })));
const GalleryPage = lazy(() => import('@/app/pages/public/GalleryPage').then((m) => ({ default: m.GalleryPage })));
const LocationPage = lazy(() => import('@/app/pages/public/LocationPage').then((m) => ({ default: m.LocationPage })));
const ContactPage = lazy(() => import('@/app/pages/public/ContactPage').then((m) => ({ default: m.ContactPage })));
const RulesPage = lazy(() => import('@/app/pages/public/RulesPage').then((m) => ({ default: m.RulesPage })));
const LegalPage = lazy(() => import('@/app/pages/LegalPage').then((m) => ({ default: m.LegalPage })));
const PricingPage = lazy(() => import('@/app/pages/PricingPage').then((m) => ({ default: m.PricingPage })));
const VisitPage = lazy(() => import('@/app/pages/public/VisitPage').then((m) => ({ default: m.VisitPage })));
const LoginPage = lazy(() => import('@/app/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const AuthCallbackPage = lazy(() => import('@/app/pages/AuthCallbackPage').then((m) => ({ default: m.AuthCallbackPage })));
const ForgotPasswordPage = lazy(() => import('@/app/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/app/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const ActivateAccountPage = lazy(() => import('@/portal/pages/ActivateAccountPage').then((m) => ({ default: m.ActivateAccountPage })));
const CompleteProfilePage = lazy(() => import('@/portal/pages/CompleteProfilePage').then((m) => ({ default: m.CompleteProfilePage })));
const AuthRouteShell = lazy(() => import('@/app/providers/AuthRouteShell').then((m) => ({ default: m.AuthRouteShell })));
const ReceiptVerificationPage = lazy(() => import('@/app/pages/public/ReceiptVerificationPage').then((m) => ({ default: m.ReceiptVerificationPage })));

function PublicRouteFallback() {
  return <div className="min-h-screen bg-slate-50" />;
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
        <Route path="/" element={<LandingPage />} />
        <Route path="/lead-signup/callback" element={<LeadSignupCallbackPage />} />
        <Route path="/owner-invite/:token" element={<OwnerLeadInvitePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/facilities" element={<FacilitiesPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/location" element={<LocationPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/rules" element={<RulesPage />} />
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
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/visit/:hostelSlug" element={<VisitPage />} />
        <Route path="/verify/r/:token" element={<ReceiptVerificationPage />} />
      </Route>

      {/* ── Auth & utility ───────────────────────────────────────────── */}
      <Route element={<AuthShell />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/activate" element={<ActivateAccountPage />} />
        <Route path="/activate/:token" element={<ActivateAccountPage />} />
        <Route path="/invite/:token" element={<ActivateAccountPage />} />
        <Route path="/complete-profile" element={<CompleteProfilePage />} />
      </Route>
    </>
  );
}
