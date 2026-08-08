import { createContext, useContext, useEffect, type PropsWithChildren } from 'react';

/**
 * The two StayO token scopes extracted from the design source — see
 * src/styles/tokens/marketing.css and product.css. There is no "legacy"
 * value here on purpose: screens that haven't migrated yet simply render
 * outside any ThemeProvider and keep resolving theme.css's unscoped :root
 * tokens, untouched.
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
 * tree, not the React tree, so a portaled sheet/toast would silently fall
 * back to theme.css's legacy :root values without this. Setting it on <html>
 * (an ancestor of the portal too) fixes that for every portaled component,
 * not just this one. Only one ThemeProvider is ever mounted at a time in
 * practice (one route = one shell), so this doesn't race between scopes.
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  useEffect(() => {
    const previous = document.documentElement.dataset.appTheme;
    document.documentElement.dataset.appTheme = theme;
    return () => {
      if (previous) {
        document.documentElement.dataset.appTheme = previous;
      } else {
        delete document.documentElement.dataset.appTheme;
      }
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
