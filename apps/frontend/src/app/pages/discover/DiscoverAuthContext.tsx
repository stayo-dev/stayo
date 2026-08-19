import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { LoginModal, type LoginModalUser } from '@shared/ui-patterns/LoginModal';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import {
  HANDOFF_DELAY_MS,
  crossSurfaceHandoff,
  type CrossSurfaceHandoff,
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
  /** Set when the account that just signed in belongs to the other side. */
  const [handoff, setHandoff] = useState<CrossSurfaceHandoff | null>(null);

  // A full page load, not a route change: the owner app has its own providers
  // and session bootstrap.
  useEffect(() => {
    if (!handoff) return;
    const timer = window.setTimeout(() => window.location.assign(handoff.path), HANDOFF_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [handoff]);

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
      // The move is announced rather than performed silently: being thrown
      // into a different app the instant you type a password reads as a bug,
      // or as somebody else's account. See `crossSurfaceLogin.ts`.
      const crossing = crossSurfaceHandoff(
        { role: user.role, tenantId: (user as any).tenantId },
        'discovery',
      );
      if (crossing) {
        setHandoff(crossing);
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
        the way WelcomePage does. So the modal was resolving `theme.css`'s
        unscoped `:root`, where `--primary` is still the **retired navy**
        `#1B2D5B`, and the sheet came up in the old identity.

        Scoping it to `marketing` resolves the real brand tokens instead
        (`--primary: #a45d44`, Terra Cotta). ThemeProvider is required rather
        than a wrapper div because the modal portals to `document.body` via
        Radix — CSS custom properties cascade through the DOM tree, not the
        React tree — and ThemeProvider is what also stamps `<html>`.
      */}
      {handoff && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: 'rgba(20,14,10,.55)' }}
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-[20rem] rounded-[20px] bg-white p-5 text-center shadow-2xl">
            <p className="text-[14px] font-bold text-[#221E1A]">Signed in</p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[#6E6459]">{handoff.message}</p>
            <p className="mt-3 text-[11.5px] font-semibold text-[#B46A55]">Taking you there…</p>
          </div>
        </div>
      )}

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
