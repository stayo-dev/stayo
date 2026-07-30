import { useLegacyAuthAdapter } from './adapters/legacyAuthAdapter';
import type { OwnerSession } from './types';

/**
 * The ONLY hook Dashboard/Tenants/Hostel/Money/Expenses/Alerts/More real-data
 * hooks are allowed to call for "who is logged in, which hostel(s) do they
 * own." Everything downstream (React Query hooks, feature components) reads
 * `ownerId`/`hostels`/`primaryHostelId` from here — never from
 * `useAuth()`/`AuthContext` or `MockOwnerJourneyContext` directly.
 *
 * Today this delegates to `adapters/legacyAuthAdapter`, a dev/integration-only
 * wrapper around the existing real (pre-StayO) auth system — see that file's
 * doc comment. When a real StayO signup/activation/auth flow exists, only
 * this function's body changes (swap the adapter), with zero changes to any
 * consumer.
 */
export function useOwnerSession(): OwnerSession {
  return useLegacyAuthAdapter();
}

export type { OwnerSession, OwnerSessionHostel } from './types';
