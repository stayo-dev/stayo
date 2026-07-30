import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { RequireAdminSession } from './RequireAdminSession';
import { ProtectedAppProviders } from '@/app/providers/ProtectedAppProviders';

function AdminRouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  );
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
