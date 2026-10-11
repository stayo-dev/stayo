import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { LoginModal, type LoginModalUser } from '@shared/ui-patterns/LoginModal';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import {
  crossSurfaceHandoff,
} from '@shared/lib/crossSurfaceLogin';

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

      // An owner or admin who signs in from Discover wants their own app, not
      // this one. A tenant — with or without a tenancy — stays exactly where
      // they were, which is the whole point of signing in here.
      //
      // Straight to their dashboard — no "taking you there" card in between.
      // A full page load: the owner/admin apps have their own providers and
      // session bootstrap. See `crossSurfaceLogin.ts`.
      const crossing = crossSurfaceHandoff(
        { role: user.role, tenantId: (user as any).tenantId },
        'discovery',
      );
      if (crossing) {
        window.location.assign(crossing.path);
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
      {/*
        `LoginModal` is token-driven (`bg-primary`, `text-foreground`…), and
        Discover renders outside any ThemeProvider — it hard-codes its palette
        the way WelcomePage does. So the modal resolved `theme.css`'s unscoped
        `:root`, which used to hold the retired navy identity, and the sheet
        came up in the old brand. That `:root` now carries the Stayo product
        tokens (ADR-172), so the fallback is no longer a branding bug — but
        the scope below is still correct and still wanted: this is a marketing
        surface, and marketing's Terra Cotta is not product's Warm Clay.

        Scoping it to `marketing` resolves the real brand tokens instead
        (`--primary: #a45d44`, Terra Cotta). ThemeProvider is required rather
        than a wrapper div because the modal portals to `document.body` via
        Radix — CSS custom properties cascade through the DOM tree, not the
        React tree — and ThemeProvider is what also stamps `<html>`.
      */}
      <ThemeProvider theme="marketing">
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
      </ThemeProvider>
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

/**
 * The same context, or null outside the provider.
 *
 * `AppBottomNav` opens the sign-in sheet from the "Log in" tab, and it is
 * mounted by a shell that may one day render outside `DiscoverAuthProvider`.
 * Throwing there would take the whole navigation bar down to save one tap, so
 * the nav asks and falls back to routing when the answer is no.
 */
export function useDiscoverAuthOptional(): DiscoverAuthValue | null {
  return useContext(DiscoverAuthContext);
}
