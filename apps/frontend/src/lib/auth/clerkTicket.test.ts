import { afterEach, describe, expect, it, vi } from 'vitest';
import { redeemSignInTicket } from './clerkTicket';

/**
 * `redeemSignInTicket` against a fake, already-loaded `window.Clerk`. Node-only
 * like the rest of this suite: the SDK is replaced by a recording stub, so this
 * proves what the function asks Clerk to do — not that Clerk's servers agree.
 */
function installClerk(opts: { sessionOwner?: string | null; hasSession?: boolean }) {
  const calls: string[] = [];
  const hasSession = opts.hasSession ?? false;
  const clerk = {
    loaded: true,
    load: vi.fn(),
    session: hasSession ? { id: 'sess_existing' } : null,
    user: hasSession ? { externalId: opts.sessionOwner ?? null } : null,
    signOut: vi.fn(async (cb?: () => void) => {
      calls.push('signOut');
      await cb?.();
    }),
    client: {
      signIn: {
        create: vi.fn(async () => {
          calls.push('signIn.create');
          return { status: 'complete', createdSessionId: 'sess_new' };
        }),
      },
    },
    setActive: vi.fn(async () => {
      calls.push('setActive');
    }),
  };
  (globalThis as unknown as { window: unknown }).window = { Clerk: clerk };
  return { clerk, calls };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('redeemSignInTicket with a Clerk session already in the browser', () => {
  it('logged out: redeems the ticket exactly as before, with no sign-out', async () => {
    const { clerk, calls } = installClerk({ hasSession: false });
    await redeemSignInTicket('tkt', 'p1');
    expect(calls).toEqual(['signIn.create', 'setActive']);
    expect(clerk.client.signIn.create).toHaveBeenCalledWith({ strategy: 'ticket', ticket: 'tkt' });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_new' });
    expect(clerk.signOut).not.toHaveBeenCalled();
  });

  it('same person already signed in: keeps the session and never creates a second sign-in', async () => {
    // This is the reported failure: create() against an existing session is what Clerk
    // rejects with 400 `session_exists`.
    const { clerk, calls } = installClerk({ hasSession: true, sessionOwner: 'p1' });
    await redeemSignInTicket('tkt', 'p1');
    expect(calls).toEqual([]);
    expect(clerk.client.signIn.create).not.toHaveBeenCalled();
    expect(clerk.signOut).not.toHaveBeenCalled();
  });

  it('a different person is signed in: ends only that session, then redeems', async () => {
    const { clerk, calls } = installClerk({ hasSession: true, sessionOwner: 'someone-else' });
    await redeemSignInTicket('tkt', 'p1');
    expect(calls).toEqual(['signOut', 'signIn.create', 'setActive']);
    // The callback form is what suppresses Clerk's default post-sign-out navigation.
    expect(clerk.signOut).toHaveBeenCalledWith(expect.any(Function));
  });

  it('cannot tell whose session it is: replaces rather than adopts it', async () => {
    const noOwner = installClerk({ hasSession: true, sessionOwner: null });
    await redeemSignInTicket('tkt', 'p1');
    expect(noOwner.calls).toEqual(['signOut', 'signIn.create', 'setActive']);

    const noExpected = installClerk({ hasSession: true, sessionOwner: 'p1' });
    await redeemSignInTicket('tkt');
    expect(noExpected.calls).toEqual(['signOut', 'signIn.create', 'setActive']);
  });

  it('still rejects an incomplete sign-in', async () => {
    const { clerk } = installClerk({ hasSession: false });
    clerk.client.signIn.create.mockResolvedValueOnce({ status: 'needs_first_factor', createdSessionId: null } as never);
    await expect(redeemSignInTicket('tkt', 'p1')).rejects.toThrow(/sign in again/i);
  });
});
