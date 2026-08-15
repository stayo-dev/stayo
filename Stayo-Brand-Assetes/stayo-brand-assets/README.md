`# Stayo — Brand Assets

**Manage. Automate. Grow.**
Stayo is an AI-powered hostel management platform by Trishul Solutions.
Open `index.html` in a browser for a visual overview of everything below.

---

## The logo

A custom **"S" monogram** that hides a home and a window inside the letter:

- **S** → Stayo
- **door / house** → every stay starts here
- **4-pane window** → rooms & units, organized and managed

Three colourways are provided for every lockup — **terracotta** (primary),
**white** (for dark / photo backgrounds), and **charcoal** (mono).

| Lockup | Use it for |
|---|---|
| `full` | the default — mark stacked over the wordmark |
| `horizontal` | headers, nav bars, email signatures, wide spaces |
| `mark` | app icons, avatars, favicons, stickers — anywhere tight |
| `wordmark` | when the mark already appears nearby |

**Clear space:** keep at least the height of the window motif clear on all sides.
**Minimum size:** mark ≥ 24 px, full lockup ≥ 40 px tall. Never stretch, recolour
outside the palette, add effects, or place the terracotta logo on a busy mid-tone.

---

## Colour

| Name | Hex | Role |
|---|---|---|
| Warm Clay | `#B46A55` | Primary brand |
| Terra Cotta | `#A45D44` | Deep accent |
| Dusty Orange | `#D2986C` | Light accent / highlights |
| Latte | `#EBD9C4` | Light surface |
| Charcoal | `#2F2F2F` | Text / dark surface |
| Cream | `#F7F3EE` | Background |

Tokens are ready to drop in: `color/colors.css` (CSS variables),
`color/colors.json`, `color/colors.txt`.

## Typography

- **Manrope** — headings, UI, the wordmark. Weights 600–800.
- **Inter** — body copy and long text.

Both are free on Google Fonts. Pairing rule: Manrope carries personality up top,
Inter keeps paragraphs quiet and legible.

---

## What's in the pack

```
logo/          Vector logos (SVG) — full · horizontal · mark · wordmark × 3 colours
logo-png/      High-res transparent PNGs of the same
icon/          App icons (clay / charcoal / cream) at 1024·512·192 + full favicon set
social/        Ready-to-post images, correct sizes:
                 og-1200x630 · x-post-1600x900 · x-header-1500x500
                 instagram-post-1080x1080 · instagram-story-1080x1920
                 linkedin-banner-1584x396 · profile-400x400
pattern/       Brand pattern tile (SVG/PNG) + ready backgrounds (cream & clay)
stickers/      Die-cut sticker sheet + individual stickers (badge, mark, logo, tagline, house)
marketing/     Business card (front & back) · web/hero banner with CTA
color/         Colour tokens (CSS/JSON/TXT) + palette sheet
index.html     Visual preview of the whole system
```

All social images are exported at the exact platform dimensions, so they upload
without cropping. Vectors (SVG) scale to any size with no quality loss — use those
for print or large formats; use the PNGs where a raster is required.

---

*Built by Trishul Solutions · stayo.in*
