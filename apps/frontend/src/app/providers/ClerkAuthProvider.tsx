import { Suspense, lazy, useMemo, type PropsWithChildren } from 'react';
import { readClerkConfig } from '@lib/auth/clerkConfig';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * Clerk, mounted so that it can neither take the app down nor slow it down
 * (ADR-176, Phase 2).
 *
 * 1. **It is optional.** `ClerkProvider` throws when `publishableKey` is
 *    missing, and Clerk is additive in this phase — Supabase is still the live
 *    session authority. An unset key must mean "Clerk sign-in unavailable", not
 *    a white screen for every user. When unconfigured this renders its children
 *    untouched and the app behaves exactly as it did before Clerk existed.
 *
 * 2. **It is lazy.** The SDK lives behind a dynamic import in `ClerkRuntime`,
 *    so it is a separate chunk that is never fetched while Clerk is unconfigured
 *    — which is today, for every visitor to the public landing page.
 *
 * The `Suspense` fallback is the brand loading screen rather than `children`:
 * rendering the app and then swapping it under a provider would remount the
 * entire tree. It is only ever reached when Clerk *is* configured.
 */

const ClerkRuntime = lazy(() =>
  import('./ClerkRuntime').then((m) => ({ default: m.ClerkRuntime })),
);

export function ClerkAuthProvider({ children }: PropsWithChildren) {
  // Resolved once: the publishable key is inlined at build time and cannot
  // change while the tab is open.
  const config = useMemo(() => readClerkConfig(), []);

  if (!config.configured) {
    if (import.meta.env.DEV) {
      // Deliberately not an error: this is a supported state in Phase 2, and
      // `reason: 'wrong_env_prefix'` in particular is a setup mistake worth
      // naming rather than a failure worth shouting about.
      console.info(`[clerk] ${config.message}`);
    }
    return <>{children}</>;
  }

  return (
    <Suspense fallback={<StayoLoadingScreen />}>
      <ClerkRuntime publishableKey={config.publishableKey}>{children}</ClerkRuntime>
    </Suspense>
  );
}
