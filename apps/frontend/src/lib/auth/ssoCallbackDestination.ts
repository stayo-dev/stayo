/**
 * Carries "where this Google sign-in should end up" across the OAuth round
 * trip on the SSO callback URL itself (2026-09-24, [[Bugs]]).
 *
 * `authenticateWithRedirect({ redirectUrlComplete })` does NOT decide where
 * `<AuthenticateWithRedirectCallback>` sends the browser. clerk-js's
 * `handleRedirectCallback` builds its destination from the component's own
 * props and the provider options only (`new RedirectUrls(options, props)` —
 * no search params, and nothing read back off the sign-in attempt). So once a
 * flow passes through `/sign-in/sso-callback` — always the case for a Google
 * account Clerk has never seen, which must be transferred to a sign-up
 * client-side — it lands on the callback's fallback, and whatever the caller
 * put in `redirectUrlComplete` is lost. Discover's `?flow=discover_signup`
 * (ADR-233) was lost exactly this way, for exactly the brand-new users it
 * exists for.
 *
 * PURE — no `window` access; callers pass `location.search`.
 */

export const SSO_CALLBACK_PATH = '/sign-in/sso-callback';
export const DEFAULT_AFTER_SSO = '/auth/callback';

const AFTER_PARAM = 'after';

/** `/sign-in/sso-callback?after=<destination>` — relative; make it absolute before handing it to Clerk. */
export function buildSsoCallbackPath(destination: string): string {
  const params = new URLSearchParams({ [AFTER_PARAM]: destination });
  return `${SSO_CALLBACK_PATH}?${params.toString()}`;
}

/**
 * The destination to finish on, read back off the callback URL.
 *
 * Only a same-origin path is honoured: this value arrives in a URL anyone can
 * craft, and the callback redirects to it, so anything that could leave this
 * origin (`//host`, `/\host`, a scheme) falls back to the default instead.
 */
export function readSsoCallbackDestination(search: string): string {
  const raw = new URLSearchParams(search).get(AFTER_PARAM);
  if (!raw) return DEFAULT_AFTER_SSO;

  const isSameOriginPath =
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    !raw.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(raw);

  return isSameOriginPath ? raw : DEFAULT_AFTER_SSO;
}
