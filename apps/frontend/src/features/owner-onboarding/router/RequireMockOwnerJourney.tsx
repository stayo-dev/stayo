import { Navigate, Outlet } from 'react-router-dom';
import { useMockOwnerJourney } from '../context/MockOwnerJourneyContext';

interface RequireMockOwnerJourneyProps {
  require: 'authenticated' | 'activated';
}

/**
 * Route guard for the mock owner journey — redirects to `/` if the required
 * step hasn't happened yet, so pasting a deep link (e.g. `/onboarding`)
 * doesn't skip the login/activation steps. Not the real `ProtectedRoute`: see
 * MockOwnerJourneyContext for why this journey needs its own gate.
 */
export function RequireMockOwnerJourney({ require }: RequireMockOwnerJourneyProps) {
  const journey = useMockOwnerJourney();
  const ok = require === 'activated' ? journey.activated : journey.authenticated;
  if (!ok) return <Navigate to="/" replace />;
  return <Outlet />;
}
