# Hostel share links — design

**Date:** 2026-08-19
**Status:** approved, implementing
**Related:** [[Features]], [[APIs]], [[Frontend]], [[Decisions]] ADR-084

## The problem

A seeker who finds a hostel on Stayo has no way to send it to a friend, and an
owner has no way to send their own listing to anyone. Copying the URL out of
the address bar does not solve it either: `apps/frontend` is a **static Vite
SPA** whose every path serves one `index.html` carrying site-wide Open Graph
tags, so a listing link pasted into WhatsApp previews as the generic "Stayo |
Hostel Management Platform" card. WhatsApp, Instagram, Telegram and Slack
crawlers do not execute JavaScript, so no client-side meta-tag library can fix
this.

The share has to carry the hostel's **cover photo**, name, city and price —
that is the whole reason a link gets tapped.

## What we are building

1. A public share URL — `yourstayo.com/h/<slug>` — backed by a server-rendered
   preview page.
2. A share button on the Discovery listing page and on the owner's marketing
   page.

Deliberately **not** in scope: share buttons on result cards or the Saved list
(more chrome on an already-busy card), and attaching the photo as a file to
the share sheet (the OG preview does that job; file sharing is unsupported on
desktop and patchy in Android WebViews).

## The share URL

`GET /h/:slug` on the frontend domain is a Vercel rewrite to
`https://api.yourstayo.com/api/discover/share/:slug`, which returns
`text/html`. This is the same shape as the existing `/pay/:token` rewrite —
an established route in this repo, not a new deployment concept.

**Rewrite order matters.** `apps/frontend/vercel.json`'s catch-all
(`/((?!api/)(?!.*\.[a-zA-Z0-9]{1,5}$).*)` → `/index.html`) matches `/h/x`, so
the share rewrite must be listed before it. `/h` is free in the SPA router.

The page carries:

- `og:title` — "<name> — <city> on Stayo"
- `og:description` — only facts we hold: starting price, sharing options,
  meals, verified status. Never a rating, never an invented number.
- `og:image` — the approved cover photo (ImageKit, transformed to 1200×630 via
  `?tr=w-1200,h-630,fo-auto`), falling back to the site `og-cover.png` when the
  hostel has no photos. Absolute `https` URL — a `data:` URI would render
  nothing in every crawler.
- `og:url` + `<link rel="canonical">` → `/discover/h/<slug>`, so the short link
  does not compete with the listing in search.
- `twitter:card = summary_large_image`.

Its body is a visible card (photo, name, city, price, "View on Stayo"), and
humans are moved on with `location.replace()` plus a `<meta http-equiv=refresh>`
and a plain link for the no-JS case. Crawlers stop at the tags.

**Visibility is the existing predicate.** The route reads through
`discoveryService.getShareCard(slug)`, which uses the one `DISCOVERABLE`
constant — the same gate search and the listing page use. A hostel an admin
suspends must stop previewing everywhere at once; a second copy of that rule is
precisely the drift `DISCOVERABLE` exists to prevent. An unlisted or unknown
slug returns **404** with a plain "not listed" page and the generic image —
never a hostel photo.

`getShareCard` composes rather than recalculates: `listingPhotos()` for the
cover, `summariseRooms()` for the starting price and sharing sizes.

Responses are cached (`s-maxage` of a few minutes): a link pasted into a busy
group is fetched by a crawler per recipient, and the DB should not see each
one. Short enough that a de-listed hostel stops previewing quickly.

## The buttons

**Discovery listing page** — a share icon beside the heart in the gallery.

**Owner marketing page** — a share action in the header, enabled only when
`published !== null && hostel.public_slug`, both already present in
`getEditorState`'s payload, so no new endpoint. Disabled otherwise, saying the
listing has to be live first — which is the same condition the public page
enforces, stated in advance rather than as a 404.

Behaviour: `navigator.share({ title, text, url })` where supported — that is
the OS sheet, the only route to Instagram and the one that lists every chat app
the person actually has. Where unsupported (most desktop browsers), copy the
link and toast. A cancelled share is a no-op, not an error.

URL building, message text and the share-vs-copy decision live in a pure
`shareListing.ts` with colocated tests; the components stay thin renderers
(this repo's frontend tests are node-environment only).

## Testing

- Backend pure tests for the share-card projection and the rendered meta tags:
  hostel with photos, without photos, without a price, and unlisted. Added to
  `vitest.pure.config.ts`'s include allowlist — a new pure test file otherwise
  silently never runs.
- Frontend tests for the URL/text builders and the fallback decision.
- Real verification, not just unit tests: request the `/h/` URL with a WhatsApp
  user-agent and assert the tags resolve to the hostel's ImageKit cover, and
  drive the button in a browser.

## Known limit

Whether `api.yourstayo.com` serves `/api/discover/share/...` in production
exactly as it serves `/api/payments/pay/...` is proven only by the first
deploy. Same app, same rewrite shape, but it is unverified from here.
