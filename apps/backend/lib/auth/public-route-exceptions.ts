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

/**
 * Paths under a public prefix that stay public but want to know *who* is
 * asking when there is an answer.
 *
 * A third category, because the first two are not enough. `GET .../reviews`
 * must serve published reviews to anyone — a signed-out visitor, a link
 * crawler — so it cannot require a session. But it also returns the reader's
 * own pending review and whether they may write one, and the public branch of
 * `middleware.ts` strips every identity header. So a signed-in resident was
 * told "Sign in to write a review" while holding a perfectly good session:
 * `getSeeker()` saw nothing, and eligibility came back `SIGNED_OUT`.
 *
 * For these paths middleware verifies a token when one is present and passes
 * the identity through — and when verification fails for any reason (expired,
 * revoked, idle, malformed) it **continues anonymously instead of returning
 * 401**. A stale token in someone's browser must never turn a public page into
 * an error, and a revoked one must never be honoured.
 */
const IDENTITY_OPTIONAL_UNDER_PUBLIC: { pattern: RegExp; methods: Set<string> }[] = [
  {
    // Reading reviews: public, but tells a resident theirs is with Stayo and
    // that they may write one.
    pattern: /^\/api\/discover\/hostels\/[^/]+\/reviews\/?$/,
    methods: new Set(["GET"]),
  },
  {
    // Confirming a tenancy claim must stay reachable by someone with no
    // account yet (a genuinely new profile gets created for them), but a
    // signed-in marketplace-account tenant's session should be used rather
    // than stripped — `tenancy-claim-service.ts` reads `profileId` off it
    // instead of trusting a client-supplied body field.
    pattern: /^\/api\/tenancy-claim\/confirm\/?$/,
    methods: new Set(["POST"]),
  },
];

export function allowsOptionalIdentity(pathname: string, method: string): boolean {
  const verb = String(method || "").toUpperCase();
  return IDENTITY_OPTIONAL_UNDER_PUBLIC.some(
    (rule) => rule.pattern.test(pathname) && rule.methods.has(verb),
  );
}
