/**
 * Sharing a hostel — the decisions, without the DOM.
 *
 * The link that gets shared is `/h/<slug>`, **not** the listing URL. That path
 * is rewritten (see `vercel.json`) to a backend-rendered page carrying the
 * hostel's photo and price as Open Graph tags, which is the only way a chat
 * app shows anything but the generic Stayo card — this frontend is a static
 * SPA with one `index.html` for every route, and link crawlers do not run
 * JavaScript. See ADR-084.
 *
 * PURE — runs under vitest's node environment, like every other decision
 * module in this app. The components are thin renderers over it.
 */

export interface ShareTarget {
  name: string;
  slug: string;
  city?: string | null;
}

/** The public share link for a hostel. `origin` comes from `window.location`. */
export function buildShareUrl(slug: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/h/${slug}`;
}

/**
 * What the sender sees pre-filled in WhatsApp before they hit send.
 *
 * Deliberately short and free of sales language: it is written in the
 * *sender's* voice, appearing in their own chat as though they typed it, and
 * "Check out this AMAZING hostel!!" is not something a person sends a friend.
 * The link's own preview card carries the price and the photo, so repeating
 * them here would just be noise above the card.
 */
export function buildShareText(hostel: ShareTarget): string {
  return hostel.city ? `${hostel.name}, ${hostel.city} — on Stayo` : `${hostel.name} — on Stayo`;
}

export type ShareMethod = "native" | "copy";

/**
 * Which way this device shares.
 *
 * `navigator.share` is the OS sheet — the only route to Instagram, and the
 * one that lists whichever chat apps the person actually has installed. It
 * exists on essentially every mobile browser and on almost no desktop one,
 * where copying the link is what a person would do anyway.
 *
 * Passed the capability rather than reading `navigator` directly, so the
 * decision is testable without a DOM.
 */
export function shareMethodFor(canShare: boolean): ShareMethod {
  return canShare ? "native" : "copy";
}

/**
 * Whether a rejected `navigator.share()` deserves a fallback.
 *
 * Dismissing the OS sheet rejects with `AbortError`, and treating that as a
 * failure — copying the link and toasting "Link copied" at someone who just
 * cancelled — makes the cancel feel broken. Any other error is a real failure
 * and should fall back to the clipboard.
 */
export function shouldFallbackAfterShareError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name !== "AbortError";
}

/**
 * The targets offered in the share sheet.
 *
 * Chosen for who actually uses Stayo — students and parents in India — rather
 * than copied from a US product's list. WhatsApp comes first because for this
 * audience it *is* messaging; Messenger is omitted for the same reason, and
 * because its web share needs a registered Facebook app id we do not have.
 *
 * Every one of these is a plain URL contract: no SDK, no app id, no key.
 */
export type ShareChannel = 'whatsapp' | 'telegram' | 'email' | 'sms' | 'facebook' | 'x';

export interface ShareLink {
  channel: ShareChannel;
  label: string;
  href: string;
  /** Whether it should open in a new tab. `mailto:`/`sms:` must not. */
  external: boolean;
}

/**
 * Built from the same `url` and `text` the native sheet uses, so a link shared
 * from the sheet and one shared from the OS are identical — the preview card
 * (ADR-084) is what carries the photo and price either way.
 */
export function buildShareLinks(hostel: ShareTarget, url: string): ShareLink[] {
  const text = buildShareText(hostel);
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const withLink = encodeURIComponent(`${text}\n${url}`);

  return [
    {
      channel: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${withLink}`,
      external: true,
    },
    {
      channel: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
      external: true,
    },
    {
      channel: 'email',
      label: 'Email',
      // Subject carries the hostel; the body carries the link on its own line
      // so it stays clickable in every mail client.
      href: `mailto:?subject=${encodedText}&body=${withLink}`,
      external: false,
    },
    {
      channel: 'sms',
      label: 'Messages',
      // `?&body=` is the form both iOS and Android accept; `?body=` alone is
      // dropped by some iOS versions.
      href: `sms:?&body=${withLink}`,
      external: false,
    },
    {
      channel: 'facebook',
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      external: true,
    },
    {
      channel: 'x',
      label: 'X',
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      external: true,
    },
  ];
}

/**
 * The one-line summary under the hostel's name in the sheet, the way Airbnb
 * shows "Villa in Baga · ★5.0 · 2 bedrooms".
 *
 * Only facts we actually hold. A rating is omitted entirely rather than shown
 * as "0.0" or "No rating" — a share sheet is the moment someone vouches for a
 * place to a friend, and a hollow number there reads worse than silence.
 */
export function buildShareSummary(input: {
  city?: string | null;
  hostelType?: string | null;
  startingPrice?: number | null;
  reviewCount?: number | null;
  rating?: number | null;
}): string {
  const parts: string[] = [];

  const type = String(input.hostelType ?? '').trim().toUpperCase();
  const kind = type === 'BOYS' ? 'Boys hostel' : type === 'GIRLS' ? 'Girls hostel' : 'Hostel';
  parts.push(input.city ? `${kind} in ${input.city}` : kind);

  if (typeof input.rating === 'number' && input.rating > 0 && (input.reviewCount ?? 0) > 0) {
    parts.push(`★${input.rating.toFixed(1)}`);
  }

  if (typeof input.startingPrice === 'number' && input.startingPrice > 0) {
    parts.push(`from ₹${Math.round(input.startingPrice).toLocaleString('en-IN')}/mo`);
  }

  return parts.join(' · ');
}
