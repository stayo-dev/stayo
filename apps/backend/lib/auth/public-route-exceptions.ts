/**
 * Paths that sit *under* a public prefix but must still be authenticated.
 *
 * `PUBLIC_ROUTES` is prefix-matched, and the public branch of `middleware.ts`
 * strips every identity header and never sets `x-auth-mode` — so `getSession`
 * inside any route beneath a public prefix always returns null, by design.
 *
 * That is right for reading and wrong for writing. `/api/discover/hostels` is
 * public so anyone can browse; `POST .../reviews` lives under it because it is
 * the same resource, and it silently became unauthenticatable — a signed-in
 * person submitting a review got "Sign in to continue" with a perfectly good
 * session in hand.
 *
 * The alternative was moving the write to a path outside the prefix, which
 * would have split one resource across two URL trees to work around a
 * matching rule. This states the exception instead.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

const AUTHENTICATED_UNDER_PUBLIC: { pattern: RegExp; methods: Set<string> }[] = [
  {
    // Writing a review needs an account; reading the published ones does not.
    pattern: /^\/api\/discover\/hostels\/[^/]+\/reviews\/?$/,
    methods: new Set(["POST", "PATCH", "PUT", "DELETE"]),
  },
];

export function requiresSessionDespitePublicPrefix(pathname: string, method: string): boolean {
  const verb = String(method || "").toUpperCase();
  return AUTHENTICATED_UNDER_PUBLIC.some(
    (rule) => rule.pattern.test(pathname) && rule.methods.has(verb),
  );
}
