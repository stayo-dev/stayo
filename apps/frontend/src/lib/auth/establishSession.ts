/**
 * Turn a sign-in response into a live session in this browser (ADR-204).
 *
 * One function for every place that signs someone in, so the rule lives in
 * one spot: a Clerk ticket is redeemed with Clerk, and any Supabase session
 * this browser still holds from before the cutover is dropped locally — it
 * would only 401 (the backend refuses pre-Clerk tokens for a moved account)
 * and, worse, shadow the new Clerk session in the API client.
 *
 * The Supabase branch exists only for a backend still mid-deploy and is
 * removed with it in Phase 4.
 */
import { supabase } from '../supabaseClient';
import { readSessionHandoff } from './sessionHandoff';
import { signOutClerk } from './clerkBrowser';
import { readHandoffProfileId } from './existingClerkSession';

export class SessionEstablishmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionEstablishmentError';
  }
}

/** Returns which provider now holds the session. Throws SessionEstablishmentError. */
export async function establishSession(responseData: unknown): Promise<'clerk' | 'supabase'> {
  const handoff = readSessionHandoff(responseData);

  if (handoff.kind === 'clerk_ticket') {
    try {
      const { redeemSignInTicket } = await import('./clerkTicket');
      await redeemSignInTicket(handoff.ticket, readHandoffProfileId(responseData));
    } catch (error) {
      throw new SessionEstablishmentError(error instanceof Error ? error.message : String(error));
    }
    // Only when there is one: signing out an empty Supabase client still
    // fires SIGNED_OUT at every listener.
    const { data } = await supabase.auth.getSession();
    if (data.session) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return 'clerk';
  }

  if (handoff.kind === 'supabase') {
    const { error } = await supabase.auth.setSession({
      access_token: handoff.accessToken,
      refresh_token: handoff.refreshToken,
    });
    if (error) throw new SessionEstablishmentError(error.message);
    return 'supabase';
  }

  throw new SessionEstablishmentError('The server accepted the sign-in but returned no session.');
}

/**
 * End every session this browser holds, whichever provider it belongs to.
 * Never throws — sign-out must always complete locally.
 */
export async function clearLocalSessions(): Promise<void> {
  await Promise.all([
    signOutClerk(),
    supabase.auth.signOut({ scope: 'local' }).catch(() => undefined),
  ]);
}
