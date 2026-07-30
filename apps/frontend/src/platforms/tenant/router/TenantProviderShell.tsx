import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { ProtectedTenantRoute } from '@/app/components/ProtectedTenantRoute';
import { ProtectedAppProviders } from '@/app/providers/ProtectedAppProviders';

function TenantRouteFallback() {
  return (
    <div className="min-h-screen bg-background px-4 py-5">
      <div className="space-y-4">
        <div className="h-28 rounded-2xl bg-muted animate-pulse" />
        <div className="h-16 rounded-xl bg-muted animate-pulse" />
        <div className="h-36 rounded-xl bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export function TenantProviderShell() {
  return (
    <ProtectedAppProviders>
      <ProtectedTenantRoute>
        <Suspense fallback={<TenantRouteFallback />}>
          <Outlet />
        </Suspense>
      </ProtectedTenantRoute>
    </ProtectedAppProviders>
  );
}
