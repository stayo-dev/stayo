import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { ownerService } from '@features/owners/api';
import { queryKeys } from '@lib/queryKeys';
import type { OwnerSession, OwnerSessionHostel } from '../types';

interface HostelsResponse {
  hostels: { id: string; name: string }[];
}

/**
 * TEMPORARY, dev/integration-only adapter — wraps the existing real legacy
 * auth (context/AuthContext.tsx's useAuth(), built for the pre-StayO app) so
 * the owner dashboard can be developed and verified against real backend
 * data before a real StayO signup/activation flow exists. No dashboard
 * component may import `useAuth`/`AuthContext` directly — only
 * `useOwnerSession()` (../useOwnerSession.ts), so that swapping this file
 * for a real StayO adapter later is a one-file change, not a rewrite.
 */
export function useLegacyAuthAdapter(): OwnerSession {
  const { user, loading: authLoading } = useAuth();
  const isOwner = user?.role === 'owner' || user?.role === 'admin';

  const hostelsQuery = useQuery({
    queryKey: queryKeys.owner.hostels(),
    queryFn: async () => {
      const data = (await ownerService.getHostels()) as HostelsResponse;
      return data.hostels ?? [];
    },
    enabled: Boolean(user) && isOwner,
    staleTime: 60_000,
  });

  const hostels: OwnerSessionHostel[] = (hostelsQuery.data ?? []).map((h) => ({ id: h.id, name: h.name }));

  return {
    ownerId: user?.owner_id ?? user?.id ?? null,
    ownerName: user?.name ?? null,
    hostels,
    // Convenience default for single-hostel owners only — screens that deal
    // with multiple hostels must still let the owner choose explicitly
    // rather than silently operating on hostels[0] (see CLAUDE.md's
    // "must not fall back to first hostel" invariant).
    primaryHostelId: hostels[0]?.id ?? null,
    isLoading: authLoading || (isOwner && hostelsQuery.isLoading),
    isAuthenticated: Boolean(user) && isOwner,
  };
}
