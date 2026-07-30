import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import { ProtectedAppProviders } from '@/app/providers/ProtectedAppProviders';

function OwnerRouteFallback() {
  return (
    <div className="min-h-screen bg-background px-4 py-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-10 w-48 rounded-lg bg-muted animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
        </div>
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export function OwnerProviderShell() {
  return (
    <ProtectedAppProviders>
      <ProtectedRoute allowedRoles={['owner']}>
        <Suspense fallback={<OwnerRouteFallback />}>
          <Outlet />
        </Suspense>
      </ProtectedRoute>
    </ProtectedAppProviders>
  );
}
