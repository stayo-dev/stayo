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

/**
 * The same button, positioned for the mobile shells (owner, tenant), which have
 * a bottom nav and no header bar to hang it in.
 *
 * Fixed rather than in-flow so it cannot reflow a layout that was extracted
 * pixel-for-pixel from the design files — and because it collapses to nothing
 * whenever there is no Clerk session, which is every session today, it adds no
 * element to the current DOM at all.
 */
export function ClerkAccountSlot() {
  const clerk = useClerkSessionState();

  if (clerkPresence(clerk) !== 'signed-in') return null;

  return (
    <div className="fixed right-3 top-3 z-50 sm:right-[max(0.75rem,calc(50%-232px))]">
      <ClerkUserButton />
    </div>
  );
}
