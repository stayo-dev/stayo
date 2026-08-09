import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AuthShellProviders } from './AuthShellProviders';
import { StayoLoadingScreen } from '@shared/ui/brand';

/** Auth screens are full-screen takeovers with nothing already mounted underneath. */
function AuthRouteFallback() {
  return <StayoLoadingScreen />;
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

