import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { AppShell } from '@/app/layouts/AppShell';

const TenantAppShell = lazy(() =>
  import('@/app/layouts/TenantAppShell').then((m) => ({ default: m.TenantAppShell })),
);
const TenantProviderShell = lazy(() => import('./TenantProviderShell').then((m) => ({ default: m.TenantProviderShell })));
const TenantFoodPage = lazy(() => import('../pages/TenantFoodPage').then((m) => ({ default: m.TenantFoodPage })));
const TenantHomePage = lazy(() => import('../pages/TenantHomePage').then((m) => ({ default: m.TenantHomePage })));
const TenantMoneyPage = lazy(() => import('../pages/TenantMoneyPage').then((m) => ({ default: m.TenantMoneyPage })));
const TenantRoomPage = lazy(() => import('../pages/TenantRoomPage').then((m) => ({ default: m.TenantRoomPage })));
const TenantComplaintsPage = lazy(() => import('../pages/TenantComplaintsPage').then((m) => ({ default: m.TenantComplaintsPage })));
const TenantHelpPage = lazy(() => import('../pages/TenantHelpPage').then((m) => ({ default: m.TenantHelpPage })));
const TenantProfilePortalPage = lazy(() =>
  import('@/portal/pages/TenantProfilePortalPage').then((m) => ({ default: m.TenantProfilePortalPage })),
);
const TenantMoveOutPage = lazy(() => import('@/portal/pages/TenantMoveOutPage').then((m) => ({ default: m.TenantMoveOutPage })));
const TenantRenewalPage = lazy(() => import('../pages/TenantRenewalPage').then((m) => ({ default: m.TenantRenewalPage })));
const TenantPaymentReturnPage = lazy(() =>
  import('@/portal/pages/TenantPaymentReturnPage').then((m) => ({ default: m.TenantPaymentReturnPage })),
);

/**
 * Cold entry into the tenant app — nothing is mounted yet, so there is no
 * layout to skeleton. Continues the boot splash's loading screen. Tab-to-tab
 * transitions use the layout skeleton in TenantProviderShell instead.
 */
function TenantRouteFallback() {
  return <StayoLoadingScreen />;
}

/**
 * Chrome for full-screen takeover sub-pages salvaged from the frozen
 * `src/portal` tree (no bottom nav, own back button) — matches the owner
 * side's Tenant Detail / Hostel Drilldown "outside the shell" convention.
 */
function TenantSubPage({ title, backTo, children }: { title: string; backTo: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background px-4 pb-10 pt-6 sm:px-6">
      <div className="mb-4 flex items-center gap-2">
        <button type="button" onClick={() => navigate(backTo)} className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h1 className="font-display text-[18px] font-extrabold text-foreground">{title}</h1>
      </div>
      {children}
    </div>
  );
}

function TenantBoundary() {
  return (
    <Suspense fallback={<TenantRouteFallback />}>
      <TenantProviderShell />
    </Suspense>
  );
}

/**
 * StayO tenant-app route tree — flat IA, no drill-down beyond the Room
 * overlay system, one modal type — implemented as real routes instead of
 * client-only state. Tabs are Home/Payments/Food/Room, plus the app-wide
 * shared Profile and Explore tabs mounted outside this tree (one single-
 * level nav — see `ACTIVE_TENANT_TABS` in `appNavConfig.ts`; supersedes
 * ADR-078's Explore/Dashboard/Profile outer bar + Home/Money/Room/Food/
 * Complaints inner strip). Complaints is no longer a tab — `/tenant/
 * complaints` renders as a full-screen takeover (own back button, no bottom
 * nav) reached contextually from Room, same "outside the shell" pattern as
 * `/tenant/move-out` below. The remaining sub-pages salvage real logic from
 * the frozen `src/portal` tree and the previously-orphaned
 * `TenantRenewalPage`.
 */
export function TenantRoutes() {
  return (
    <Route element={<TenantBoundary />}>
      <Route path="/payment-return" element={<TenantPaymentReturnPage />} />
      <Route element={<AppShell><Outlet /></AppShell>}>
        <Route element={<TenantAppShell />}>
          <Route path="/tenant" element={<Navigate to="/tenant/home" replace />} />
          <Route path="/tenant/home" element={<TenantHomePage />} />
          <Route path="/tenant/money" element={<TenantMoneyPage />} />
          <Route path="/tenant/room" element={<TenantRoomPage />} />
          <Route path="/tenant/food" element={<TenantFoodPage />} />
        </Route>
      </Route>
      <Route path="/tenant/complaints" element={<TenantComplaintsPage />} />
      <Route
        path="/tenant/profile/details"
        element={
          <TenantSubPage title="Personal details" backTo="/profile">
            <TenantProfilePortalPage />
          </TenantSubPage>
        }
      />
      <Route
        path="/tenant/move-out"
        element={
          <TenantSubPage title="Move-out" backTo="/profile">
            <TenantMoveOutPage />
          </TenantSubPage>
        }
      />
      <Route path="/tenant/profile/help" element={<TenantHelpPage />} />
      <Route
        path="/tenant/renewal"
        element={
          <div className="min-h-screen bg-background px-4 pb-10 pt-6 sm:px-6">
            <TenantRenewalPage />
          </div>
        }
      />
    </Route>
  );
}
