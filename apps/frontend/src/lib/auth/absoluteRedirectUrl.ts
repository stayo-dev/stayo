/**
 * Why `authenticateWithRedirect`'s `redirectUrl`/`redirectUrlComplete` must be
 * fully-qualified, not relative (found 2026-09-23, [[Bugs]]).
 *
 * Google's OAuth callback lands on Clerk's own server (`clerk.yourstayo.com/
 * v1/oauth_callback`), not back in the browser tab that started the flow — so
 * the *server*, not the page, is what resolves `redirectUrl` into the URL it
 * finally sends the browser to. A relative path has no meaning to a server
 * with no notion of "the page that called this" the way same-origin `fetch`
 * would; Clerk resolves it against its own default domain — this app's Clerk
 * Account Portal (`accounts.yourstayo.com`) — not `yourstayo.com`. Live-tested
 * and confirmed: a relative `/sign-in/sso-callback` landed the browser on
 * `accounts.yourstayo.com/sign-in/sso-callback`, and the Account Portal then
 * ran its *own* default sign-in/up UI with its *own* default redirect
 * (`https://yourstayo.com/`), discarding the `redirectUrlComplete` this app
 * had set.
 *
 * PURE — no `window` access, so the caller (which has one) supplies `origin`.
 */
export function toAbsoluteUrl(pathOrUrl: string, origin: string): string {
  return new URL(pathOrUrl, origin).toString();
}
