/**
 * Who hit the 404, and where they were actually trying to go (ADR-209).
 *
 * There was one catch-all, outside every shell, rendering the marketing
 * layout. So an owner who mistyped a URL three levels into `/owner/hostels/…`
 * was dropped onto the public site — marketing header, marketing footer, and a
 * "Find a stay" button inviting them to shop for a hostel room. A signed-in
 * tenant got the same. The page was correct about *what* had happened and
 * wrong about *who it was talking to*.
 *
 * This module answers only the second part. It is pure so the copy and the
 * links can be tested without rendering a router.
 */

export type NotFoundAudience = 'owner' | 'tenant' | 'public';

export interface NotFoundLink {
  to: string;
  label: string;
}

export interface NotFoundCopy {
  audience: NotFoundAudience;
  /** The headline. Stays in the building metaphor the brand already uses. */
  title: string;
  body: string;
  primary: NotFoundLink;
  /** Omitted where a second destination would be noise rather than help. */
  secondary?: NotFoundLink;
}

/** Route prefixes that mean the person is already inside a signed-in app. */
const OWNER_PREFIX = '/owner';
const TENANT_PREFIXES = ['/tenant', '/stay', '/payment-return'];

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Which app the unknown URL belongs to, by path alone.
 *
 * Path, not the signed-in role: a signed-in owner reading a public listing and
 * mistyping the URL is on the public site and should be answered there. The
 * question is "which part of Stayo is this address in", and only the address
 * knows.
 */
export function notFoundAudience(pathname: string): NotFoundAudience {
  const path = String(pathname ?? '').toLowerCase();
  if (startsWithSegment(path, OWNER_PREFIX)) return 'owner';
  if (TENANT_PREFIXES.some((prefix) => startsWithSegment(path, prefix))) return 'tenant';
  return 'public';
}

/**
 * What the page says, and the one or two ways out worth offering.
 *
 * Each audience gets destinations that exist in *their* app. "Find a stay" is
 * right for a visitor and absurd for an owner standing in their own console.
 */
export function notFoundCopy(pathname: string): NotFoundCopy {
  const audience = notFoundAudience(pathname);

  if (audience === 'owner') {
    return {
      audience,
      title: "This page isn't part of your console",
      body: 'The address may have changed, or the link might have a typo. Your hostels and everything in them are still where you left them.',
      primary: { to: '/owner/home', label: 'Back to your dashboard' },
      secondary: { to: '/owner/hostels', label: 'Your hostels' },
    };
  }

  if (audience === 'tenant') {
    return {
      audience,
      title: "This page isn't here",
      body: "The address may have changed, or the link might have a typo. Nothing about your stay has changed.",
      primary: { to: '/tenant/home', label: 'Back home' },
      secondary: { to: '/tenant/help', label: 'Get help' },
    };
  }

  return {
    audience,
    title: "This room doesn't exist",
    body: "We couldn't find anything at that address. It may have moved, or the link might have a typo.",
    primary: { to: '/', label: 'Back home' },
    secondary: { to: '/#search', label: 'Find a stay' },
  };
}

/**
 * Whether the 404 draws its own marketing chrome.
 *
 * Inside the owner and tenant apps it does not: the shell is already around
 * it, with that app's own navigation. Wrapping it again would give the person
 * two headers and a way out of the product they are signed in to.
 */
export function wrapsInMarketingLayout(audience: NotFoundAudience): boolean {
  return audience === 'public';
}
