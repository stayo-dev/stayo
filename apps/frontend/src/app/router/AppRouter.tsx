import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminRoutes } from '@/platforms/admin/router/AdminRoutes';
import { OwnerRoutes } from '@/platforms/owner/router/OwnerRoutes';
import { ConfigRoutes } from '@/platforms/owner/router/ConfigRoutes';
import { OwnerJourneyRoutes } from '@features/owner-onboarding/router/OwnerJourneyRoutes';
import { MockOwnerJourneyProvider } from '@features/owner-onboarding/context/MockOwnerJourneyContext';
import { TenantRoutes } from '@/platforms/tenant/router/TenantRoutes';
import { PublicRoutes } from './PublicRoutes';

export function AppRouter() {
  return (
    <MockOwnerJourneyProvider>
      <Routes>
        {PublicRoutes()}
        {OwnerJourneyRoutes()}
        {OwnerRoutes()}
        {ConfigRoutes()}
        {TenantRoutes()}
        {AdminRoutes()}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MockOwnerJourneyProvider>
  );
}
