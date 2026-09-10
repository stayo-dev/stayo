import { createContext, useContext, useEffect, type PropsWithChildren } from 'react';

/**
 * The two StayO token scopes extracted from the design source — see
 * src/styles/tokens/marketing.css and product.css. There is no "legacy"
 * value here on purpose: screens that haven't migrated yet simply render
 * outside any ThemeProvider and resolve theme.css's unscoped :root. Since
 * ADR-172 that root holds the Stayo product tokens, so rendering outside a
 * scope is merely unspecific — it is no longer off-brand.
 */
export type AppTheme = 'marketing' | 'product';

const ThemeContext = createContext<AppTheme | null>(null);

/**
 * Reads the active StayO theme scope. Most components should never need
 * this — styling should resolve purely through the CSS custom properties
 * `data-app-theme` scopes (see stayo-theme.css) — but it's available for the
 * rare case where a shared component genuinely needs to branch in JS rather
 * than in CSS. Throws outside a ThemeProvider so a missing scope fails
 * loudly instead of silently rendering unstyled.
 */
export function useAppTheme(): AppTheme {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useAppTheme() must be used within a <ThemeProvider>.');
  }
  return value;
}

interface ThemeProviderProps extends PropsWithChildren {
  theme: AppTheme;
}

/**
 * Scopes the StayO design tokens to a subtree via `data-app-theme`, matching
 * the selectors defined in src/styles/tokens/*.css. Each top-level layout
 * (PublicLayout, OwnerAppShell, TenantAppShell, AuthShellLayout)
 * wraps its content in one of these with the appropriate `theme` value — the
 * scope is tied to where it's needed, not injected once globally, since a
 * single app session can have both scopes active across different routes.
 *
 * Also syncs the same attribute onto <html>. This is not redundant: Radix
 * Dialog, the vaul-based Drawer (BottomSheet), and sonner's Toaster all
 * render via a portal appended to document.body, outside this wrapper div's
 * DOM subtree — CSS custom properties only cascade through the real DOM
 * tree, not the React tree, so a portaled sheet or toast resolves whatever
 * <html> says. Setting it there covers every portaled component at once.
 *
 * That sync is stack-based rather than save-and-restore. Two providers *can*
 * be mounted at once — briefly, across a route change — and the naive version
 * let the outgoing shell's cleanup delete the incoming shell's attribute; see
 * `mounted` below.
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  useEffect(() => {
    mounted.push(theme);
    applyTopOfStack();
    return () => {
      const at = mounted.lastIndexOf(theme);
      if (at !== -1) mounted.splice(at, 1);
      applyTopOfStack();
    };
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>
      <div data-app-theme={theme} className="contents">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * Which providers are currently mounted, oldest first. A single "restore the
 * previous value" closure per provider is not enough: during a route change
 * React can mount the incoming shell before the outgoing one has run its
 * cleanup, and the outgoing cleanup then restores what it saw at *its* mount
 * time — deleting the attribute the incoming shell just set. `<html>` ends up
 * with no scope at all, which is invisible in the page itself (the wrapper
 * div above still carries it) and shows up only in portaled content: a
 * `vaul` sheet or a `createPortal` overlay renders outside that div. That is
 * how the Invite Tenant sheet and the onboarding Spotlight came up unstyled.
 *
 * A stack makes the last mounted provider the winner regardless of the order
 * cleanups happen to run in, and empties correctly when the last one leaves.
 */
const mounted: AppTheme[] = [];

function applyTopOfStack() {
  const top = mounted[mounted.length - 1];
  if (top) {
    document.documentElement.dataset.appTheme = top;
  } else {
    delete document.documentElement.dataset.appTheme;
  }
}
