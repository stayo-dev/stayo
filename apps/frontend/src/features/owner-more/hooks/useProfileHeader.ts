import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { ownerService } from '@features/owners/api';
import { queryKeys } from '@lib/queryKeys';
import { profileIdentity } from '../config/profileIdentity';

/** Only the fields the header reads — the full shape lives on `MoreProfilePage`. */
interface OwnerProfileSummary {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** From `profile_identity.photo_url`, surfaced by `getOwnerProfile`. */
  photo_url: string | null;
}

/**
 * Who the Profile screen is about.
 *
 * This was `useConfigurationHub`, and it composed four other derivations into
 * module cards, per-module area tallies and a completeness percentage — one of
 * two independently computed completeness scores the configuration audit
 * found. All of that went with the module grid.
 *
 * What remained after that was a hostel lookup feeding three gap checks, and
 * those have now moved too: they described a *hostel*, and belong on the
 * hostel's own Settings tab where the hostel id comes from the route rather
 * than from "whichever one is first" (see `config/attentionItems.ts`).
 *
 * So this hook no longer looks at a hostel at all. It answers one question —
 * who is signed in — which is the only question the screen's header asks.
 */
export function useProfileHeader() {
  const session = useOwnerSession();

  // Same query key and staleTime as the "Details" screen, so this is a cache
  // hit rather than a second request in the common case; the session name
  // carries the first paint until it resolves.
  const profileQuery = useQuery({
    queryKey: queryKeys.owner.profile(),
    queryFn: async () => (await ownerService.getProfile())?.data?.owner as OwnerProfileSummary,
    staleTime: 60_000,
  });

  return profileIdentity({
    sessionName: session.ownerName,
    profileName: profileQuery.data?.name,
    email: profileQuery.data?.email,
    phone: profileQuery.data?.phone,
    photoUrl: profileQuery.data?.photo_url,
  });
}
