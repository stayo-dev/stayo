import { lazy, Suspense } from 'react';
import { Navigate, Route } from 'react-router-dom';
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
const MoneyPage = lazy(() => import('@features/owner-money/pages/MoneyPage').then((m) => ({ default: m.MoneyPage })));
const FoodPage = lazy(() => import('@features/owner-food/pages/FoodPage').then((m) => ({ default: m.FoodPage })));
const KitchenSheetPage = lazy(() => import('@features/owner-food/pages/KitchenSheetPage').then((m) => ({ default: m.KitchenSheetPage })));
const FoodPollsPage = lazy(() => import('@features/owner-food/pages/FoodPollsPage').then((m) => ({ default: m.FoodPollsPage })));
const AlertsPage = lazy(() => import('@features/owner-alerts/pages/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const MoreSettingsPage = lazy(() => import('@features/owner-more/pages/MoreSettingsPage').then((m) => ({ default: m.MoreSettingsPage })));
const MoreProfilePage = lazy(() => import('@features/owner-more/pages/MoreProfilePage').then((m) => ({ default: m.MoreProfilePage })));
const MoreHostelIdentityPage = lazy(() =>
  import('@features/owner-more/pages/MoreHostelIdentityPage').then((m) => ({ default: m.MoreHostelIdentityPage })),
);
const MoreNoticesPage = lazy(() => import('@features/owner-more/pages/MoreNoticesPage').then((m) => ({ default: m.MoreNoticesPage })));
const MoreServiceRequestsPage = lazy(() => import('@features/owner-more/pages/MoreServiceRequestsPage').then((m) => ({ default: m.MoreServiceRequestsPage })));
const MoreHelpPage = lazy(() => import('@features/owner-more/pages/MoreHelpPage').then((m) => ({ default: m.MoreHelpPage })));
const MoreAboutPage = lazy(() => import('@features/owner-more/pages/MoreAboutPage').then((m) => ({ default: m.MoreAboutPage })));
const MoreWorkspaceConfigPage = lazy(() =>
  import('@features/owner-more/pages/MoreWorkspaceConfigPage').then((m) => ({ default: m.MoreWorkspaceConfigPage })),
);
const MoreConfigurationHubPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigurationHubPage').then((m) => ({ default: m.MoreConfigurationHubPage })),
);
const MoreConfigHostelPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigHostelPage').then((m) => ({ default: m.MoreConfigHostelPage })),
);
const MoreConfigFinancePage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigFinancePage').then((m) => ({ default: m.MoreConfigFinancePage })),
);
const MoreConfigAutomationPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAutomationPage').then((m) => ({ default: m.MoreConfigAutomationPage })),
);
const MoreConfigAgreementsPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementsPage').then((m) => ({ default: m.MoreConfigAgreementsPage })),
);
const MoreConfigAgreementTemplatesPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementTemplatesPage').then((m) => ({ default: m.MoreConfigAgreementTemplatesPage })),
);
const MoreConfigAgreementTemplatePage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAgreementTemplatePage').then((m) => ({ default: m.MoreConfigAgreementTemplatePage })),
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
const MoreConfigAccountPage = lazy(() =>
  import('@features/owner-more/pages/MoreConfigAccountPage').then((m) => ({ default: m.MoreConfigAccountPage })),
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
const MoreConfigAgreementDurationPage = lazy(() =>
  import('@features/owner-more/billing-policy/MoreConfigAgreementDurationPage').then((m) => ({ default: m.MoreConfigAgreementDurationPage })),
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
export function OwnerRoutes() {
  return (
    <Route element={<OwnerBoundary />}>
      <Route element={<OwnerAppShell />}>
        <Route path="/owner" element={<Navigate to="/owner/home" replace />} />
        <Route path="/owner/home" element={<OwnerDashboardPreviewPage />} />

        {/* Today's rent-collection work queue (ADR-045). */}
        <Route path="/owner/money/collect" element={<CollectionQueuePage />} />
        <Route path="/owner/agreements/review" element={<AgreementQueuePage />} />
        <Route path="/owner/rooms/vacant" element={<VacancyQueuePage />} />
        <Route path="/owner/tenants" element={<TenantsPage />} />

        <Route path="/owner/money" element={<MoneyPage />} />
        <Route path="/owner/food" element={<FoodPage />} />
        <Route path="/owner/food/kitchen" element={<KitchenSheetPage />} />
        <Route path="/owner/food/polls" element={<FoodPollsPage />} />
        <Route path="/owner/alerts" element={<AlertsPage />} />

        <Route path="/owner/more" element={<MoreConfigurationHubPage />} />
        <Route path="/owner/more/workspace-configuration" element={<MoreWorkspaceConfigPage />} />
        <Route path="/owner/more/settings" element={<MoreSettingsPage />} />
        {/* Billing behaviour has exactly one home (ADR-043). These three
            routes each used to own a slice of it and could overwrite each
            other; they now redirect to the canonical screen so existing links,
            bookmarks and back-stack entries still land somewhere real. */}
        <Route path="/owner/more/billing" element={<Navigate to="/owner/more/configuration/finance/billing-policy" replace />} />
        <Route path="/owner/more/profile" element={<MoreProfilePage />} />
        <Route path="/owner/more/hostel" element={<MoreHostelIdentityPage />} />
        <Route path="/owner/more/hostel/:hostelId" element={<MoreHostelIdentityPage />} />
        <Route path="/owner/more/notices" element={<MoreNoticesPage />} />
        <Route path="/owner/more/service-requests" element={<MoreServiceRequestsPage />} />
        <Route path="/owner/more/help" element={<MoreHelpPage />} />
        <Route path="/owner/more/about" element={<MoreAboutPage />} />

        <Route path="/owner/more/configuration" element={<MoreConfigurationHubPage />} />
        <Route path="/owner/more/configuration/hostel" element={<MoreConfigHostelPage />} />
        <Route path="/owner/more/configuration/hostel/agreement-duration" element={<MoreConfigAgreementDurationPage />} />
        <Route path="/owner/more/configuration/hostel/tenant-defaults" element={<Navigate to="/owner/more/configuration/hostel/agreement-duration" replace />} />
        <Route path="/owner/more/configuration/finance" element={<MoreConfigFinancePage />} />
        <Route path="/owner/more/configuration/automation" element={<MoreConfigAutomationPage />} />
        <Route path="/owner/more/configuration/agreements" element={<MoreConfigAgreementsPage />} />
        <Route path="/owner/more/configuration/agreements/templates" element={<MoreConfigAgreementTemplatesPage />} />
        <Route path="/owner/more/configuration/agreements/template" element={<MoreConfigAgreementTemplatePage />} />
        <Route path="/owner/more/configuration/agreements/requirement" element={<MoreConfigAgreementRequirementPage />} />
        <Route path="/owner/more/configuration/agreements/clauses" element={<MoreConfigAgreementClausesPage />} />
        <Route path="/owner/more/configuration/notifications" element={<MoreConfigNotificationsPage />} />
        <Route path="/owner/more/configuration/account" element={<MoreConfigAccountPage />} />
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
      </Route>
    </Route>
  );
}
