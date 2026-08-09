import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { RequireAdminSession } from './RequireAdminSession';
import { ProtectedAppProviders } from '@/app/providers/ProtectedAppProviders';
import { StayoLoadingScreen } from '@shared/ui/brand';

function AdminRouteFallback() {
  return <StayoLoadingScreen />;
}

export function AdminProviderShell() {
  return (
    <ProtectedAppProviders>
      <RequireAdminSession>
        <Suspense fallback={<AdminRouteFallback />}>
          <Outlet />
        </Suspense>
      </RequireAdminSession>
    </ProtectedAppProviders>
  );
}
