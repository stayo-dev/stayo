import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { LoginModal, type LoginModalUser } from '@shared/ui-patterns/LoginModal';

/**
 * Sign-in for Stayo Discover, in place.
 *
 * Discover used to send a signed-out visitor to `/login`, which renders the
 * **owner marketing page** with the modal open (ADR-035's one-login-surface
 * rule). For an owner that is coherent; for a student who tapped "Saved" it
 * dumps them onto a pitch about occupancy dashboards and loses the hostel they
 * were looking at.
 *
 * So Discover keeps the same `LoginModal` — the very component the owner page
 * uses, no second auth surface — and opens it over whatever screen the visitor
 * is already on. ADR-035's intent was one login *component*, not one URL that
 * every audience must be routed through.
 *
 * It opens on the **signup** tab by default: nearly everyone arriving here is
 * new, and `mode="tenant"` is the only mode that has a signup tab at all.
 */
interface DiscoverAuthValue {
  /** Open the sign-in sheet. `onDone` fires only on a successful auth. */
  openSignIn: (options?: { tab?: 'login' | 'signup'; onDone?: () => void }) => void;
}

const DiscoverAuthContext = createContext<DiscoverAuthValue | null>(null);

export function DiscoverAuthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'login' | 'signup'>('signup');
  // Held in state rather than a ref so a re-render can't drop the callback
  // between opening the modal and the user finishing the form.
  const [onDone, setOnDone] = useState<(() => void) | null>(null);

  const openSignIn = useCallback((options?: { tab?: 'login' | 'signup'; onDone?: () => void }) => {
    setTab(options?.tab ?? 'signup');
    // Wrapped, because a bare function passed to setState would be called as
    // an updater instead of stored.
    setOnDone(() => options?.onDone ?? null);
    setOpen(true);
  }, []);

  const handleSuccess = useCallback(
    (user: LoginModalUser) => {
      setOpen(false);
      const role = (user.role || '').toLowerCase();

      // An owner or admin who signs in from Discover wants their own app, not
      // this one. A tenant — with or without a tenancy — stays exactly where
      // they were, which is the whole point of signing in here.
      if (role === 'owner') {
        window.location.assign('/owner/home');
        return;
      }
      if (role === 'admin') {
        window.location.assign('/admin');
        return;
      }

      onDone?.();
      setOnDone(null);
    },
    [onDone],
  );

  const value = useMemo(() => ({ openSignIn }), [openSignIn]);

  return (
    <DiscoverAuthContext.Provider value={value}>
      {children}
      <LoginModal
        open={open}
        mode="tenant"
        initialTab={tab}
        onClose={() => {
          setOpen(false);
          setOnDone(null);
        }}
        onSuccess={handleSuccess}
      />
    </DiscoverAuthContext.Provider>
  );
}

export function useDiscoverAuth(): DiscoverAuthValue {
  const context = useContext(DiscoverAuthContext);
  if (!context) {
    throw new Error('useDiscoverAuth must be used inside DiscoverAuthProvider');
  }
  return context;
}
