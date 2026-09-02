import { lazy, Suspense } from 'react';
import { Navigate, Route, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { StayoLoadingScreen } from '@shared/ui/brand';

const OwnerAppShell = lazy(() =>
  import('@/app/layouts/OwnerAppShell').then((m) => ({ default: m.OwnerAppShell })),
);
const OwnerProviderShell = lazy(() => import('./OwnerProviderShell').then((m) => ({ default: m.OwnerProviderShell })));

const OwnerDashboardPreviewPage = lazy(() =>
  import('@features/owner-onboarding/pages/OwnerDashboardPreviewPage').then((m) => ({ default: m.OwnerDashboardPreviewPage })),
);
const TenantsPage = lazy(() => import('@features/owner-tenants/pages/TenantsPage').then((m) => ({ default: m.TenantsPage })));
const TenantDetailPage = lazy(() =>
  import('@features/owner-tenants/pages/TenantDetailPage').then((m) => ({ default: m.TenantDetailPage })),
);
const PendingActivationsPage = lazy(() =>
  import('@features/owner-tenants/pages/PendingActivationsPage').then((m) => ({ default: m.PendingActivationsPage })),
);
const PendingVerificationsPage = lazy(() =>
  import('@features/owner-tenants/pages/PendingVerificationsPage').then((m) => ({ default: m.PendingVerificationsPage })),
);
const HostelDrilldownLayout = lazy(() =>
  import('@features/hostel-drilldown/layout/HostelDrilldownLayout').then((m) => ({ default: m.HostelDrilldownLayout })),
);
const HostelOverviewPage = lazy(() =>
  import('@features/hostel-drilldown/pages/HostelOverviewPage').then((m) => ({ default: m.HostelOverviewPage })),
);
const HostelRoomsPage = lazy(() => import('@features/hostel-drilldown/pages/HostelRoomsPage').then((m) => ({ default: m.HostelRoomsPage })));
const HostelBuilderPage = lazy(() =>
  import('@features/owner-hostel-builder/pages/HostelBuilderPage').then((m) => ({ default: m.HostelBuilderPage })),
);
const HostelTenantsPage = lazy(() =>
  import('@features/hostel-drilldown/pages/HostelTenantsPage').then((m) => ({ default: m.HostelTenantsPage })),
);
const HostelMarketingPage = lazy(() =>
  import('@features/hostel-drilldown/pages/HostelMarketingPage').then((m) => ({ default: m.HostelMarketingPage })),
);
const HostelSettingsPage = lazy(() =>
  import('@features/hostel-drilldown/pages/HostelSettingsPage').then((m) => ({ default: m.HostelSettingsPage })),
);
const MoneyPage = lazy(() => import('@features/owner-money/pages/MoneyPage').then((m) => ({ default: m.MoneyPage })));
const MoneyInPage = lazy(() => import('@features/owner-money/pages/MoneyInPage').then((m) => ({ default: m.MoneyInPage })));
const FoodPage = lazy(() => import('@features/owner-food/pages/FoodPage').then((m) => ({ default: m.FoodPage })));
const MealPlanPage = lazy(() => import('@features/owner-food/pages/MealPlanPage').then((m) => ({ default: m.MealPlanPage })));
const RetiredToMealPlan = lazy(() => import('@features/owner-food/pages/RetiredFoodRoutes').then((m) => ({ default: m.RetiredToMealPlan })));
const KitchenSheetPage = lazy(() => import('@features/owner-food/pages/KitchenSheetPage').then((m) => ({ default: m.KitchenSheetPage })));
const FoodPollsPage = lazy(() => import('@features/owner-food/pages/FoodPollsPage').then((m) => ({ default: m.FoodPollsPage })));
const AlertsPage = lazy(() => import('@features/owner-alerts/pages/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const AlertsLeadsPage = lazy(() => import('@features/owner-alerts/pages/AlertsLeadsPage').then((m) => ({ default: m.AlertsLeadsPage })));
const AlertsAnnouncementsPage = lazy(() =>
  import('@features/owner-alerts/pages/AlertsAnnouncementsPage').then((m) => ({ default: m.AlertsAnnouncementsPage })),
);
const AlertsRenewalsPage = lazy(() => import('@features/owner-alerts/pages/AlertsRenewalsPage').then((m) => ({ default: m.AlertsRenewalsPage })));
const AlertsRequestsPage = lazy(() => import('@features/owner-alerts/pages/AlertsRequestsPage').then((m) => ({ default: m.AlertsRequestsPage })));
const MorePasswordPage = lazy(() =>
  import('@features/owner-more/pages/MorePasswordPage').then((m) => ({ default: m.MorePasswordPage })),
);
const MorePayoutAccountPage = lazy(() =>
  import('@features/owner-more/pages/MorePayoutAccountPage').then((m) => ({ default: m.MorePayoutAccountPage })),
);
const MoreConfigInviteDefaultsPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigInviteDefaultsPage').then((m) => ({ default: m.MoreConfigInviteDefaultsPage })),
);
const MoreProfilePage = lazy(() => import('@features/owner-more/pages/MoreProfilePage').then((m) => ({ default: m.MoreProfilePage })));
const MoreHostelIdentityPage = lazy(() =>
  import('@features/owner-more/pages/MoreHostelIdentityPage').then((m) => ({ default: m.MoreHostelIdentityPage })),
);
const MoreNoticesPage = lazy(() => import('@features/owner-more/pages/MoreNoticesPage').then((m) => ({ default: m.MoreNoticesPage })));
const MoreHelpPage = lazy(() => import('@features/owner-more/pages/MoreHelpPage').then((m) => ({ default: m.MoreHelpPage })));
const MoreConfigurationHubPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigurationHubPage').then((m) => ({ default: m.MoreConfigurationHubPage })),
);
const MoreConfigAgreementsPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementsPage').then((m) => ({ default: m.MoreConfigAgreementsPage })),
);
const MoreConfigAgreementEditorPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementEditorPage').then((m) => ({ default: m.MoreConfigAgreementEditorPage })),
);
const MoreConfigAgreementTemplatesPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementTemplatesPage').then((m) => ({ default: m.MoreConfigAgreementTemplatesPage })),
);
const MoreConfigAgreementTemplatePage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementTemplatePage').then((m) => ({ default: m.MoreConfigAgreementTemplatePage })),
);
const MoreConfigAgreementSignaturePage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementSignaturePage').then((m) => ({ default: m.MoreConfigAgreementSignaturePage })),
);
const MoreConfigAgreementClausesPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementClausesPage').then((m) => ({ default: m.MoreConfigAgreementClausesPage })),
);
const MoreConfigAgreementRequirementPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementRequirementPage').then((m) => ({
    default: m.MoreConfigAgreementRequirementPage,
  })),
);
const MoreConfigNotificationsPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigNotificationsPage').then((m) => ({ default: m.MoreConfigNotificationsPage })),
);
const AgreementQueuePage = lazy(() =>
  import('@features/owner-workqueue/AgreementQueuePage').then((m) => ({ default: m.AgreementQueuePage })),
);
const VacancyQueuePage = lazy(() =>
  import('@features/owner-workqueue/VacancyQueuePage').then((m) => ({ default: m.VacancyQueuePage })),
);
const CollectionQueuePage = lazy(() =>
  import('@features/owner-collection/CollectionQueuePage').then((m) => ({ default: m.CollectionQueuePage })),
);
const MoreConfigRentSchedulePage = lazy(() =>
  import('@features/owner-more/billing-policy/MoreConfigRentSchedulePage').then((m) => ({ default: m.MoreConfigRentSchedulePage })),
);
const MoreConfigPartPaymentsPage = lazy(() =>
  import('@features/owner-more/billing-policy/MoreConfigPartPaymentsPage').then((m) => ({ default: m.MoreConfigPartPaymentsPage })),
);
const MoreConfigDepositPage = lazy(() =>
  import('@features/owner-more/billing-policy/MoreConfigDepositPage').then((m) => ({ default: m.MoreConfigDepositPage })),
);
const MoreConfigLateFeePage = lazy(() =>
  import('@features/owner-more/billing-policy/MoreConfigLateFeePage').then((m) => ({ default: m.MoreConfigLateFeePage })),
);
const MoreConfigBillingPolicyPage = lazy(() =>
  import('@features/owner-more/billing-policy/MoreConfigBillingPolicyPage').then((m) => ({
    default: m.MoreConfigBillingPolicyPage,
  })),
);
const MoreConfigPaymentGatewayPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigPaymentGatewayPage').then((m) => ({ default: m.MoreConfigPaymentGatewayPage })),
);
const MoreConfigReceiptFooterPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigReceiptFooterPage').then((m) => ({ default: m.MoreConfigReceiptFooterPage })),
);

/**
 * Entering the owner app from cold — the provider shell, the auth gate and the
 * first page chunk are all still in flight, so there is no layout to skeleton
 * yet. Show the brand loading screen; it is what index.html's boot splash is
 * already showing, so this boundary continues that screen rather than replacing
 * it. Page-to-page transitions *inside* the owner app use the layout skeleton
 * in OwnerProviderShell instead.
 */
function OwnerRouteFallback() {
  return <StayoLoadingScreen />;
}

/** Exported so ConfigRoutes/OnboardingRoute can share the same owner auth-gate + fallback. */
export function OwnerBoundary() {
  return (
    <ErrorBoundary context="owner-routes">
      <Suspense fallback={<OwnerRouteFallback />}>
        <OwnerProviderShell />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * StayO owner-app route tree, per Stayo App.dc.html's navigation state
 * machine (tab / hostelScreen / moreScreen), implemented as real routes
 * instead of client-only state. This is the single canonical owner app —
 * these pages previously lived (mock-data-era) under `/get-started/*`
 * behind a separate, non-`ProtectedRoute` gate; migrated here so a real
 * logged-in owner session has somewhere real to land instead of the old
 * RouteScaffold placeholders. Tab pages sit inside `OwnerAppShell`; Tenant
 * Detail and the Hostel Drill-down are mounted as siblings outside it,
 * rendered as full-screen takeovers with their own back button, not
 * bottom-nav tabs.
 */
/**
 * A redirect that keeps the query string.
 *
 * `<Navigate to="...">` discards it, and `?hostelId=` is how a configuration
 * screen knows which hostel it is editing — losing it sends the owner to a
 * screen quietly editing their primary hostel instead of the one they opened.
 */
function KeepQueryRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

export function OwnerRoutes() {
  return (
    <Route element={<OwnerBoundary />}>
      <Route element={<OwnerAppShell />}>
        <Route path="/owner" element={<Navigate to="/owner/home" replace />} />
        <Route path="/owner/home" element={<OwnerDashboardPreviewPage />} />

        {/* Today's rent-collection work queue (ADR-045). */}
        <Route path="/owner/money/collect" element={<CollectionQueuePage />} />
        <Route path="/owner/money/payouts" element={<MoneyInPage />} />
        <Route path="/owner/agreements/review" element={<AgreementQueuePage />} />
        <Route path="/owner/rooms/vacant" element={<VacancyQueuePage />} />
        <Route path="/owner/tenants" element={<TenantsPage />} />

        <Route path="/owner/money" element={<MoneyPage />} />
        <Route path="/owner/food" element={<FoodPage />} />
        <Route path="/owner/food/meal-plan" element={<MealPlanPage />} />
        <Route path="/owner/food/kitchen" element={<KitchenSheetPage />} />
        <Route path="/owner/food/polls" element={<FoodPollsPage />} />
        {/* Meal Timings and the Weekly Timetable were merged into one Meal
            Plan page (ADR-121) — these two routes redirect so old
            links/bookmarks (and the Today card's "Fix" deep link) still land
            somewhere real, querystring forwarded. */}
        <Route path="/owner/food/meal-timings" element={<RetiredToMealPlan />} />
        <Route path="/owner/food/timetable" element={<RetiredToMealPlan />} />
        <Route path="/owner/alerts" element={<AlertsPage />} />

        <Route path="/owner/more" element={<MoreConfigurationHubPage />} />
        {/* Billing behaviour has exactly one home (ADR-043). These three
            routes each used to own a slice of it and could overwrite each
            other; they now redirect to the canonical screen so existing links,
            bookmarks and back-stack entries still land somewhere real. */}
        <Route path="/owner/more/billing" element={<Navigate to="/owner/more/configuration/finance/billing-policy" replace />} />
        <Route path="/owner/more/profile" element={<MoreProfilePage />} />
        <Route path="/owner/more/password" element={<MorePasswordPage />} />
        <Route path="/owner/more/payout-account" element={<MorePayoutAccountPage />} />
        <Route path="/owner/more/hostel" element={<MoreHostelIdentityPage />} />
        <Route path="/owner/more/hostel/:hostelId" element={<MoreHostelIdentityPage />} />
        <Route path="/owner/more/notices" element={<MoreNoticesPage />} />
        {/* The owner's copy of the service-request queue is deleted:
            `/owner/alerts/requests` is the same queue over the same service,
            with search, a tenant chat sheet and deep-links from notifications
            that this one never had. Redirected rather than removed — the help
            catalogue and older notifications still point here. */}
        <Route path="/owner/more/service-requests" element={<Navigate to="/owner/alerts/requests" replace />} />
        <Route path="/owner/more/help" element={<MoreHelpPage />} />
        {/* About was three links and a version string read from @shared/mocks;
            the links now sit at the foot of Help. */}
        <Route path="/owner/more/about" element={<Navigate to="/owner/more/help" replace />} />

        <Route path="/owner/more/configuration/hostel/tenant-defaults" element={<MoreConfigInviteDefaultsPage />} />
        {/* The old single-value screen. Kept routed because search and older
            links point at it; it now redirects to the screen that holds all
            of the invite defaults, carrying `?hostelId=` through. */}
        <Route path="/owner/more/configuration/hostel/agreement-duration" element={<KeepQueryRedirect to="/owner/more/configuration/hostel/tenant-defaults" />} />
        <Route path="/owner/more/configuration/agreements" element={<MoreConfigAgreementsPage />} />
        <Route path="/owner/more/configuration/agreements/templates" element={<MoreConfigAgreementTemplatesPage />} />
        <Route path="/owner/more/configuration/agreements/edit" element={<MoreConfigAgreementEditorPage />} />
        <Route path="/owner/more/configuration/agreements/template" element={<MoreConfigAgreementTemplatePage />} />
        <Route path="/owner/more/configuration/agreements/requirement" element={<MoreConfigAgreementRequirementPage />} />
        <Route path="/owner/more/configuration/agreements/clauses" element={<MoreConfigAgreementClausesPage />} />
        <Route path="/owner/more/configuration/agreements/signature" element={<MoreConfigAgreementSignaturePage />} />
        <Route path="/owner/more/configuration/notifications" element={<MoreConfigNotificationsPage />} />
        <Route path="/owner/more/configuration/finance/late-fees" element={<MoreConfigLateFeePage />} />
        <Route path="/owner/more/configuration/finance/rent-schedule" element={<MoreConfigRentSchedulePage />} />
        <Route path="/owner/more/configuration/finance/part-payments" element={<MoreConfigPartPaymentsPage />} />
        <Route path="/owner/more/configuration/finance/deposit" element={<MoreConfigDepositPage />} />
        <Route path="/owner/more/configuration/finance/billing-policy" element={<MoreConfigBillingPolicyPage />} />
        <Route path="/owner/more/configuration/finance/payment-gateway" element={<MoreConfigPaymentGatewayPage />} />
        <Route path="/owner/more/configuration/finance/receipt-footer" element={<MoreConfigReceiptFooterPage />} />
      </Route>

      {/* Declared before the :tenantId route so "verifications" is not
          swallowed as a tenant id. */}
      <Route path="/owner/tenants/verifications" element={<PendingVerificationsPage />} />
      <Route path="/owner/tenants/activations" element={<PendingActivationsPage />} />
      <Route path="/owner/tenants/:tenantId" element={<TenantDetailPage />} />

      {/* Alerts categories — full-screen takeovers with their own back
          button, same treatment as Tenant Detail. Static per-category routes
          rather than a single `/owner/alerts/:category`: Leads has grouping
          + a detail sheet + pagination while the other three are simple flat
          lists, so a shared dynamic page would need the same internal
          branching anyway. */}
      <Route path="/owner/alerts/leads" element={<AlertsLeadsPage />} />
      <Route path="/owner/alerts/announcements" element={<AlertsAnnouncementsPage />} />
      <Route path="/owner/alerts/renewals" element={<AlertsRenewalsPage />} />
      <Route path="/owner/alerts/requests" element={<AlertsRequestsPage />} />

      {/* Add Hostel — a full-screen build flow, not a drilldown tab. Declared
          before the drilldown so `/owner/hostels/new` is not read as a hostel
          id, and resumable at `:hostelId/build`. */}
      <Route path="/owner/hostels/new" element={<HostelBuilderPage />} />
      <Route path="/owner/hostels/:hostelId/build" element={<HostelBuilderPage />} />

      <Route path="/owner/hostels/:hostelId" element={<HostelDrilldownLayout />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<HostelOverviewPage />} />
        <Route path="rooms" element={<HostelRoomsPage />} />
        <Route path="tenants" element={<HostelTenantsPage />} />
        <Route path="marketing" element={<HostelMarketingPage />} />
        <Route path="settings" element={<HostelSettingsPage />} />
      </Route>
    </Route>
  );
}
