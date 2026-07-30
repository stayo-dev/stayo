import { useNavigate } from 'react-router-dom';
import { useMockOwnerJourney } from '@features/owner-onboarding/context/MockOwnerJourneyContext';

/** Sign-out for the mock journey: clears the session and returns to the landing page — a real action, not a placeholder. */
export function useMoreNav() {
  const navigate = useNavigate();
  const journey = useMockOwnerJourney();

  const signOut = () => {
    journey.reset();
    navigate('/');
  };

  return { signOut };
}
