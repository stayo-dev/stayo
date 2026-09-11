import { Suspense, lazy } from 'react';
import { useClerkSessionState } from '@/app/providers/clerkSessionContext';
import { clerkPresence } from '@lib/auth/sessionAuthority';

/**
 * Clerk's account menu, in the authenticated shells (ADR-176, Phase 2).
 *
 * Renders **nothing** unless there is a live Clerk session — which today means
 * nothing renders for anyone, because everyone is signed in through Supabase.
 * That is deliberate: this phase adds Clerk without moving a single user onto
 * it, so the shells must look untouched until someone actually signs in at
 * `/sign-in`. Showing an empty or signed-out Clerk widget beside the existing
 * Supabase account menu would offer two account menus that disagree.
 *
 * The import is lazy for the same reason it is in `ClerkAuthProvider`: a static
 * `@clerk/clerk-react` import here would land the SDK in the owner, tenant and
 * admin shell chunks, making every signed-in user download it for a button that
 * renders `null`. The presence check also guarantees the `ClerkProvider` that
 * `<UserButton>` requires, since `signed-in` is unreachable without one.
 */

const UserButton = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({ default: m.UserButton })),
);

export function ClerkUserButton() {
  const clerk = useClerkSessionState();

  if (clerkPresence(clerk) !== 'signed-in') return null;

  return (
    <Suspense fallback={null}>
      <UserButton afterSignOutUrl="/" />
    </Suspense>
  );
}

/*
 * There is deliberately no floating version of this button any more.
 *
 * `ClerkAccountSlot` pinned it `fixed` to the top-right corner of the owner and
 * tenant shells, on the reasoning that it "renders nothing, because nobody is
 * signed in through Clerk today". Once people were, it rendered — on top of
 * every page's own top-right action ("Collect rent" on Money, "+ Invite" on
 * Tenants). A fixed element in the corner of a design whose primary actions
 * live in that corner cannot be positioned safely, so the button is now placed
 * in-flow where account things already are: the owner's Settings header and the
 * tenant's profile header. The admin console keeps its in-flow placement.
 */
