export interface OwnerDoorSession {
  isLoading: boolean;
  isAuthenticated: boolean;
  hostelCount: number;
}

export interface OwnerDoor {
  label: string;
  to: string;
  /**
   * True when following this link is itself an answer to `/owners`'
   * "Are you a hostel owner?" prompt, so `LandingPage` opens the lead
   * conversation instead of asking again (ADR-071 point 5).
   */
  declaresOwnerIntent: boolean;
}

const LIST: OwnerDoor = { label: 'List your hostel', to: '/owners', declaresOwnerIntent: true };
const DASHBOARD: OwnerDoor = { label: 'Go to dashboard', to: '/owner/home', declaresOwnerIntent: false };

/**
 * The owner door, on every public screen.
 *
 * Owners are the paying side, so their path is permanent and one click from
 * anywhere — but it changes wording and destination rather than removing the
 * student side, because `/` must stay reachable for a signed-in owner who
 * wants to look at the marketplace they are paying for (ADR-071 point 4).
 * While the session is still loading, the signed-out wording is shown: it is
 * correct for everyone who is not yet known, and flipping the label after the
 * fact is less jarring than flipping a destination under a finger.
 */
export function ownerDoor(session: OwnerDoorSession): OwnerDoor {
  if (session.isLoading) return LIST;
  return session.isAuthenticated && session.hostelCount > 0 ? DASHBOARD : LIST;
}
