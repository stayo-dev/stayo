import { Route, Routes } from 'react-router-dom';
import { AdminRoutes } from '@/platforms/admin/router/AdminRoutes';
import { OwnerRoutes } from '@/platforms/owner/router/OwnerRoutes';
import { OwnerJourneyRoutes } from '@features/owner-onboarding/router/OwnerJourneyRoutes';
import { MockOwnerJourneyProvider } from '@features/owner-onboarding/context/MockOwnerJourneyContext';
import { TenantRoutes } from '@/platforms/tenant/router/TenantRoutes';
import { PublicRoutes } from './PublicRoutes';
import { ProfileRoutes } from './ProfileRoutes';
import { SeekerAppShell } from '@/app/providers/SeekerAppShell';
import { NotFoundPage } from '@/app/pages/public/NotFoundPage';

export function AppRouter() {
  return (
    <MockOwnerJourneyProvider>
      <Routes>
        {PublicRoutes()}
        {/* Explore/Profile and the Tenant Dashboard share one provider +
            shell tree (`SeekerAppShell`) — see its docstring — so navigating
            between them (Profile <-> Room, Explore <-> Home, etc.) is a
            normal nested-route swap, not a full remount. */}
        {/* Stayo Discover (the public marketplace) is shelved for v1 — see
            ADR-170. `DiscoverRoutes()` is unmounted; the shared Profile hub
            it used to nest (`ProfileRoutes()`) is mounted here directly so
            the Tenant Dashboard still shares one provider/shell with it. */}
        <Route element={<SeekerAppShell />}>
          {ProfileRoutes()}
          {TenantRoutes()}
        </Route>
        {OwnerJourneyRoutes()}
        {OwnerRoutes()}
        {AdminRoutes()}
        {/* Unknown URLs get a real 404 instead of a silent redirect to "/",
            which made a typo and a retired page indistinguishable. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MockOwnerJourneyProvider>
  );
}
