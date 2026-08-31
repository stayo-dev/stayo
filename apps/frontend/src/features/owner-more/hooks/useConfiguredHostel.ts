import { useParams, useSearchParams } from 'react-router-dom';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';

/**
 * Which hostel is this configuration screen editing?
 *
 * Every per-hostel settings screen used to read `session.primaryHostelId`
 * directly — fifteen call sites. That was survivable while these screens were
 * only reachable from a single Configure section, and became wrong the moment
 * they were reached from a *particular* hostel's Settings tab: an owner
 * opening their second hostel and changing its late fee would have edited
 * their first hostel's, with the second hostel's name in the header.
 *
 * This is the frontend counterpart of the rule the backend's architectural
 * invariants already enforce server-side — operational code must never fall
 * back to "first hostel". The hostel is taken from the route: a `:hostelId`
 * param, else a `?hostelId=` query the hostel Settings tab attaches to every
 * link it renders.
 *
 * The fallback to the primary hostel is kept, and is correct for the owner
 * who has exactly one — the overwhelming majority. It stops being a guess
 * because the caller that could be ambiguous now always says which.
 */
export function useConfiguredHostelId(): string | null {
  const params = useParams<{ hostelId?: string }>();
  const [search] = useSearchParams();
  const session = useOwnerSession();

  const fromRoute = params.hostelId || search.get('hostelId');
  if (fromRoute) return fromRoute;

  return session.primaryHostelId ?? null;
}
