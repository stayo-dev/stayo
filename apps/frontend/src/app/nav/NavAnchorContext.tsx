import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';

/**
 * A ref to the app-wide bottom nav element, shared upward.
 *
 * `AppShell` renders `AppBottomNav` as a *sibling* of the page outlet, so a
 * page cannot reach the nav by ref on its own — and the tenant welcome tour
 * needs to, because the nav map is the one stop that tells a new tenant the
 * other screens exist at all.
 *
 * A `document.querySelector` would have been shorter. `Spotlight` bans that
 * deliberately: a selector-anchored stop goes silently wrong the moment
 * someone renames a class, dimming the screen to highlight nothing, and no
 * check in this repo would catch it. A ref either resolves or its stop is
 * dropped.
 */
const NavAnchorContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function NavAnchorProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  return <NavAnchorContext.Provider value={ref}>{children}</NavAnchorContext.Provider>;
}

/**
 * The nav element, or `null` outside the provider. Callers must tolerate an
 * empty ref: the bar genuinely is not rendered on full-screen takeover
 * routes (see `hidesOuterNav`), and a stop pointing at it is dropped there.
 */
export function useNavAnchor(): RefObject<HTMLElement | null> | null {
  return useContext(NavAnchorContext);
}
