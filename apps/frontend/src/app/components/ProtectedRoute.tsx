import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <StayoLoadingScreen message="Signing you in…" />;
  }

  // `/login` rather than `/`: since ADR-071 the root is an audience chooser,
  // and asking someone whose session just expired whether they're a student
  // or an owner — instead of letting them sign back in — loses the thread.
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Signed in, but not for this. Unlike the no-session case above, `/` is
  // right here: we can't guess which surface they *do* belong on, and the
  // chooser is exactly the screen for that question.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
