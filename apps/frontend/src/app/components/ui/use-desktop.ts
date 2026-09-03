import * as React from "react";

/**
 * The desktop-shell breakpoint — `lg` (1024px), the same value every existing
 * desktop-aware line in this codebase already keys off (AppBottomNav's floating
 * dock, Discover's RESULTS_GRID/PAGE_SHELL, the activation two-column skeleton).
 *
 * Deliberately distinct from `use-mobile.ts`'s 768px: that is a narrow
 * "is this a phone-sized / touch viewport" check used by a couple of components
 * (the meal-plan grid swap). This one is "should the desktop application shell
 * be mounted." Below it, the app renders exactly as it does today.
 */
export const DESKTOP_BREAKPOINT = 1024;

export function getIsDesktop() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches;
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState<boolean>(getIsDesktop);

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const onChange = () => {
      setIsDesktop(mql.matches);
    };
    mql.addEventListener("change", onChange);
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
