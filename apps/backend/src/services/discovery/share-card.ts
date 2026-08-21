/**
 * The hostel share preview — what a link to a hostel looks like inside
 * WhatsApp, Instagram, Telegram or any other app that unfurls a URL.
 *
 * WHY THIS EXISTS AS A SERVER-RENDERED PAGE: `apps/frontend` is a static Vite
 * SPA, so every path serves one `index.html` with site-wide Open Graph tags —
 * a listing link pasted into a chat previews as the generic "Stayo | Hostel
 * Management Platform" card, never the hostel. Crawlers do not execute
 * JavaScript, so no client-side meta-tag library can change that. The only fix
 * is HTML that already carries the right tags when it arrives. See ADR-084.
 *
 * PURE MODULE — no I/O, no Prisma, runs under vitest.pure.config.ts. The
 * database read lives in `discoveryService.getShareCard`.
 */

export interface ShareCardInput {
  name: string;
  slug: string;
  city: string | null;
  /** Cover first — pass `listingPhotos()`'s output, not a raw column. */
  photos: string[];
  startingPrice: number | null;
  sharing: number[];
  foodIncluded: boolean;
  verified: boolean;
  /** Origin of the public site, e.g. `https://yourstayo.com`. */
  siteUrl: string;
}

export interface ShareCard {
  title: string;
  description: string;
  imageUrl: string;
  /** Where a human ends up: the real listing page. */
  listingUrl: string;
  /** The link that gets shared, and the page's own `og:url`. */
  shareUrl: string;
  name: string;
  city: string | null;
  priceLabel: string | null;
}

/** Indian digit grouping — ₹1,20,000, not ₹120,000. */
function formatRupees(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/**
 * Open Graph wants roughly 1.91:1 at 1200×630. ImageKit can do that crop at
 * the CDN, so the preview is not a 4MB portrait photo that a crawler gives up
 * on — several of them enforce a size ceiling and simply show no image.
 *
 * Only ImageKit URLs are rewritten. Anything else is passed through untouched
 * rather than guessed at, and a `data:` URI is dropped entirely: no crawler
 * renders one, and emitting it means an unfurled card with a blank space where
 * the hostel should be.
 */
export function ogImageUrl(photo: string | undefined, fallback: string): string {
  if (!photo || photo.startsWith("data:")) return fallback;
  if (!/^https?:\/\//i.test(photo)) return fallback;
  if (!photo.includes("ik.imagekit.io")) return photo;
  return photo.includes("?")
    ? `${photo}&tr=w-1200,h-630,fo-auto`
    : `${photo}?tr=w-1200,h-630,fo-auto`;
}

/**
 * The one line under the hostel's name in a chat preview.
 *
 * Only facts that exist in a column. No rating, no "popular", no distance —
 * this text is the most-read sentence Stayo writes about a hostel, and the
 * moment it contains something we cannot back, every other claim on the
 * listing is worth less.
 */
export function shareDescription(input: {
  startingPrice: number | null;
  sharing: number[];
  foodIncluded: boolean;
  verified: boolean;
}): string {
  const parts: string[] = [];

  // "Price on request" rather than ₹0: an unpriced room means the owner has
  // not said, not that the bed is free.
  parts.push(
    input.startingPrice == null
      ? "Price on request"
      : `From ₹${formatRupees(input.startingPrice)}/month`,
  );

  if (input.sharing.length > 0) {
    parts.push(input.sharing.map((capacity) => (capacity === 1 ? "single" : `${capacity}-bed`)).join(", "));
  }
  if (input.foodIncluded) parts.push("meals included");
  if (input.verified) parts.push("verified on Stayo");

  return `${parts.join(" · ")}.`;
}

export function buildShareCard(input: ShareCardInput): ShareCard {
  const site = input.siteUrl.replace(/\/+$/, "");
  const priceLabel = input.startingPrice == null ? null : `₹${formatRupees(input.startingPrice)}`;

  return {
    title: input.city ? `${input.name} — ${input.city} on Stayo` : `${input.name} on Stayo`,
    description: shareDescription(input),
    imageUrl: ogImageUrl(input.photos[0], `${site}/og-cover.png`),
    listingUrl: `${site}/discover/h/${input.slug}`,
    shareUrl: `${site}/h/${input.slug}`,
    name: input.name,
    city: input.city,
    priceLabel,
  };
}

/** Anything interpolated into the page is escaped — hostel names are owner input. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The preview page itself.
 *
 * Two audiences, one document. A crawler reads the `<head>` and stops — it
 * never runs the redirect. A person is moved to the real listing immediately
 * by `location.replace` (replace, not assign: the preview must not sit in the
 * back-button history between the chat app and the listing). The
 * `<meta refresh>` and the visible link cover the no-JS and slow-JS cases, so
 * this page is never a dead end.
 *
 * `rel="canonical"` points at the listing, so the short share link does not
 * compete with it in search results.
 */
export function renderSharePage(card: ShareCard): string {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const listingUrl = escapeHtml(card.listingUrl);
  const shareUrl = escapeHtml(card.shareUrl);
  const image = escapeHtml(card.imageUrl);
  const name = escapeHtml(card.name);
  const location = escapeHtml(card.city ?? "");
  const price = card.priceLabel ? escapeHtml(card.priceLabel) : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="canonical" href="${listingUrl}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Stayo" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${shareUrl}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${name}" />
<meta property="og:locale" content="en_IN" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${image}" />
<meta http-equiv="refresh" content="0;url=${listingUrl}" />
<style>
:root{color-scheme:light}
body{margin:0;font-family:'Inter',system-ui,sans-serif;background:#F7F3EF;color:#221E1A;
display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:420px;width:100%;background:#fff;border:1px solid #EFE6DA;border-radius:20px;overflow:hidden;
box-shadow:0 8px 24px rgba(40,30,20,.08)}
.photo{display:block;width:100%;height:220px;object-fit:cover;background:#E7D9CC}
.body{padding:18px 20px 22px}
h1{margin:0;font-size:20px;letter-spacing:-.02em}
p{margin:6px 0 0;color:#8A7F75;font-size:14px}
.price{margin-top:12px;font-size:18px;font-weight:800}
a.cta{display:block;margin-top:16px;padding:13px;border-radius:13px;background:#A45D44;color:#fff;
text-align:center;text-decoration:none;font-weight:700}
</style>
</head>
<body>
<div class="card">
<img class="photo" src="${image}" alt="${name}" />
<div class="body">
<h1>${name}</h1>
${location ? `<p>${location}</p>` : ""}
${price ? `<div class="price">${price}<span style="font-size:13px;font-weight:500;color:#8A7F75">/month</span></div>` : ""}
<a class="cta" href="${listingUrl}">View on Stayo</a>
</div>
</div>
<script>location.replace(${JSON.stringify(card.listingUrl)});</script>
</body>
</html>`;
}

/**
 * A slug that is not listed — de-listed, suspended, or never existed.
 *
 * Carries **no hostel photo and no hostel name**: a link to a hostel Stayo has
 * suspended must not keep unfurling that hostel's picture in every chat it was
 * ever pasted into. It also carries no `og:image` of its own beyond the site
 * cover, and is served with a 404 so crawlers do not cache it as a real page.
 */
export function renderUnlistedPage(siteUrl: string): string {
  const site = escapeHtml(siteUrl.replace(/\/+$/, ""));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>This hostel isn't listed — Stayo</title>
<meta name="robots" content="noindex" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Stayo" />
<meta property="og:title" content="This hostel isn't listed on Stayo" />
<meta property="og:description" content="It may have been unlisted, or the link is out of date. Plenty of other verified hostels are ready." />
<meta property="og:image" content="${site}/og-cover.png" />
<style>
body{margin:0;font-family:'Inter',system-ui,sans-serif;background:#F7F3EF;color:#221E1A;
display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
p{color:#8A7F75;font-size:14px;max-width:22rem}
a{display:inline-block;margin-top:18px;padding:13px 22px;border-radius:13px;background:#A45D44;color:#fff;
text-decoration:none;font-weight:700}
</style>
</head>
<body>
<div>
<h1 style="margin:0;font-size:20px">This hostel isn't listed</h1>
<p>It may have been unlisted, or the link is out of date. Plenty of other verified hostels are ready.</p>
<a href="${site}/discover">Browse hostels</a>
</div>
</body>
</html>`;
}
