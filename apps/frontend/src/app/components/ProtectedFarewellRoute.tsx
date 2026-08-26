import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { tenancyState } from '@/app/nav/useAppNav';
import { hasFarewell } from '@/app/nav/appNavConfig';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * The gate for `/tenant/farewell`.
 *
 * Deliberately weaker than `ProtectedTenantRoute`, and deliberately separate
 * from it: that guard *redirects here*, so reusing it would bounce this
 * screen to itself in a loop. All this one asks is that the person is signed
 * in and has a tenancy behind them — which is exactly the state
 * `ProtectedTenantRoute` turns away.
 *
 * A tenant still mid-exit (EXITING) is allowed too. They can reach the
 * dashboard as well, but if they navigate here we show them the same
 * settlement rather than telling them they don't belong. (ADR-122)
 */
export function ProtectedFarewellRoute() {
  const { user, loading } = useAuth();

  if (loading) return <StayoLoadingScreen message="Signing you in…" />;
  if (!user || user.role?.toLowerCase() !== 'tenant') return <Navigate to="/login" replace />;
  if (!hasFarewell(tenancyState(user))) return <Navigate to="/tenant/home" replace />;

  return <Outlet />;
}
