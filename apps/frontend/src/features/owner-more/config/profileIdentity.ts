import { formatIndianPhone } from '@shared/lib/phone';

/**
 * Who the Profile header is about.
 *
 * This screen used to head itself with the *workspace* — "Sri Adithya Boys
 * Hostel workspace" and the hostel's initials — while every row beneath it
 * was owner-level: their details, their password, their bank account. The
 * header named the one thing the screen does not configure. It now names the
 * owner.
 *
 * Two sources feed that, at different speeds. `useOwnerSession().ownerName`
 * is already in context and paints on the first frame; `GET /owner/me/profile`
 * is the record the owner actually edits under "Details" and wins once it
 * lands. Resolving between them is the whole design here, so it is a pure
 * function rather than a ternary buried in JSX.
 */

export interface ProfileIdentityInput {
  /** From `useOwnerSession()` — instant, but can lag behind a rename. */
  sessionName?: string | null;
  /** From `GET /owner/me/profile` — authoritative, arrives a moment later. */
  profileName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** `profile_identity.photo_url` — absent until the owner uploads one. */
  photoUrl?: string | null;
}

export interface ProfileIdentity {
  /** The H1. */
  name: string;
  /** The line under it. Empty when neither email nor phone is known. */
  sub: string;
  /** Avatar letters. Never empty — a blank circle reads as broken, not loading. */
  initials: string;
  /**
   * The photo to draw instead of the initials, when there is one. Null for a
   * blank or missing value rather than passing '' to an `<img src>`, which
   * resolves against the page URL and renders as a broken image.
   */
  photoUrl: string | null;
}

const blank = (value: string | null | undefined): boolean => !value || value.trim().length === 0;

/** `sp@example.com` → `sp`. A last resort before the placeholder. */
function emailLocalPart(email: string | null | undefined): string {
  if (blank(email)) return '';
  return (email as string).trim().split('@')[0] ?? '';
}

export function profileIdentity(input: ProfileIdentityInput): ProfileIdentity {
  const candidates = [input.profileName, input.sessionName, emailLocalPart(input.email)];
  const resolved = candidates.find((candidate) => !blank(candidate));

  // Only reachable before either source has answered — a real loading frame,
  // not a fabricated identity.
  const name = resolved ? (resolved as string).trim() : 'Your profile';

  // The backend stores E.164, so an unformatted phone reads as one 12-digit
  // run — "+918008046952" is a string to decode rather than a number to read.
  // `formatIndianPhone` groups a real Indian mobile and hands anything else
  // back untouched, so a landline is never sliced into the wrong shape.
  const sub = !blank(input.email)
    ? (input.email as string).trim()
    : !blank(input.phone)
      ? formatIndianPhone(input.phone)
      : '';

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  // Initials are computed either way, so removing a photo leaves something to
  // draw rather than an empty frame.
  const photoUrl = blank(input.photoUrl) ? null : (input.photoUrl as string).trim();

  return { name, sub, initials, photoUrl };
}
