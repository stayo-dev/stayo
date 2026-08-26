import { lazy, type ReactNode } from 'react';
import { Navigate, Route, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { TenantProviderShell } from './TenantProviderShell';
import { ProtectedFarewellRoute } from '@/app/components/ProtectedFarewellRoute';

const TenantAppShell = lazy(() =>
  import('@/app/layouts/TenantAppShell').then((m) => ({ default: m.TenantAppShell })),
);
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
const TenantFarewellPage = lazy(() => import('../pages/TenantFarewellPage').then((m) => ({ default: m.TenantFarewellPage })));
const TenantPaymentReturnPage = lazy(() =>
  import('@/portal/pages/TenantPaymentReturnPage').then((m) => ({ default: m.TenantPaymentReturnPage })),
);

/**
 * Chrome for full-screen takeover sub-pages salvaged from the frozen
 * `src/portal` tree (no bottom nav, own back button) — matches the owner
 * side's Tenant Detail / Hostel Drilldown "outside the shell" convention.
 * `AppBottomNav`'s `hidesOuterNav()` hides the shared outer nav for these
 * paths (anything under `/tenant/*` that isn't one of the four tab pages),
 * preserving that "no bottom nav" contract now that they're nested under
 * the same shared `SeekerAppShell` as the tab pages.
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
 *
 * Every route here is nested under `TenantProviderShell` (the
 * `ProtectedTenantRoute` tenancy-liveness gate — unchanged), which is itself
 * nested under the shared `SeekerAppShell` alongside `DiscoverRoutes()` —
 * there is no `AppShell`/provider instance of its own here anymore, so
 * crossing in from Explore/Profile is a normal nested-route swap, not a
 * remount.
 */
export function TenantRoutes() {
  return (
    <>
      {/*
        * Deliberately OUTSIDE `TenantProviderShell`. That shell is
        * `ProtectedTenantRoute`, which sends an EXITED tenant here — nesting
        * the farewell route inside it would redirect the screen to itself,
        * forever. It has its own, weaker gate: signed in, and has a tenancy
        * behind them. (ADR-122)
        */}
      <Route path="/tenant/farewell" element={<ProtectedFarewellRoute />}>
        <Route index element={<TenantFarewellPage />} />
      </Route>
      {tenantAppRoutes()}
    </>
  );
}

function tenantAppRoutes() {
  return (
    <Route element={<TenantProviderShell />}>
      <Route path="/payment-return" element={<TenantPaymentReturnPage />} />
      <Route element={<TenantAppShell />}>
        <Route path="/tenant" element={<Navigate to="/tenant/home" replace />} />
        <Route path="/tenant/home" element={<TenantHomePage />} />
        <Route path="/tenant/money" element={<TenantMoneyPage />} />
        <Route path="/tenant/room" element={<TenantRoomPage />} />
        <Route path="/tenant/food" element={<TenantFoodPage />} />
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
