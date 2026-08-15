import { Route, Routes } from 'react-router-dom';
import { AdminRoutes } from '@/platforms/admin/router/AdminRoutes';
import { OwnerRoutes } from '@/platforms/owner/router/OwnerRoutes';
import { OwnerJourneyRoutes } from '@features/owner-onboarding/router/OwnerJourneyRoutes';
import { MockOwnerJourneyProvider } from '@features/owner-onboarding/context/MockOwnerJourneyContext';
import { TenantRoutes } from '@/platforms/tenant/router/TenantRoutes';
import { PublicRoutes } from './PublicRoutes';
import { DiscoverRoutes } from './DiscoverRoutes';
import { NotFoundPage } from '@/app/pages/public/NotFoundPage';

export function AppRouter() {
  return (
    <MockOwnerJourneyProvider>
      <Routes>
        {PublicRoutes()}
        {DiscoverRoutes()}
        {OwnerJourneyRoutes()}
        {OwnerRoutes()}
        {TenantRoutes()}
        {AdminRoutes()}
        {/* Unknown URLs get a real 404 instead of a silent redirect to "/",
            which made a typo and a retired page indistinguishable. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MockOwnerJourneyProvider>
  );
}
