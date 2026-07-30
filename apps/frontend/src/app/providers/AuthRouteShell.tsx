import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AuthShellProviders } from './AuthShellProviders';

function AuthRouteFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-muted animate-pulse" />
        <div className="h-8 rounded bg-muted animate-pulse" />
        <div className="h-12 rounded-xl bg-muted animate-pulse" />
        <div className="h-12 rounded-xl bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export function AuthRouteShell() {
  return (
    <AuthShellProviders>
      <Suspense fallback={<AuthRouteFallback />}>
        <Outlet />
      </Suspense>
    </AuthShellProviders>
  );
}

