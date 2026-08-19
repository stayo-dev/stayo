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
