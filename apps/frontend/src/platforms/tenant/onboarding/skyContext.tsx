import { createContext, useContext, type ReactNode } from 'react';
import { skyEnv, type SkyEnv } from './skyTheme';

/**
 * Shares the active time-of-day theme with the wizard's step components.
 *
 * `ActivationLayout` already computes `skyEnv()` for its own chrome, but the
 * steps render as its `children` — directly over the same gradient, with no
 * surface of their own — and had no way to see which phase was active. They
 * used fixed daytime greys, which is why field labels faded into the dusk and
 * night gradients.
 *
 * A context rather than props: the steps are passed through `ActivationPage`,
 * so prop-drilling the theme would touch every component in between for
 * something none of them care about.
 */
const SkyContext = createContext<SkyEnv | null>(null);

export function SkyProvider({ value, children }: { value: SkyEnv; children: ReactNode }) {
  return <SkyContext.Provider value={value}>{children}</SkyContext.Provider>;
}

/**
 * The active sky. Falls back to the daytime palette when used outside a
 * provider, so a component rendered in isolation gets the original dark-on-cream
 * colours rather than white-on-white.
 */
export function useSky(): SkyEnv {
  return useContext(SkyContext) ?? skyEnv(12, 'day');
}
