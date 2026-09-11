/**
 * Colour arithmetic for proving the onboarding's text is legible over the sky.
 *
 * The onboarding paints text straight onto a time-of-day gradient, and the
 * gradient changes three times a day. Eyeballing one phase in a browser is how
 * illegible text shipped before: a colour picked against the daytime cream
 * disappeared into the night sky, and a colour picked for night vanished once
 * the sky faded back to cream further down the page. These helpers let
 * `skyTheme.test.ts` check every phase at once, against the actual gradient
 * stops, instead.
 *
 * Contrast follows WCAG 2.x: relative luminance, then (L1 + .05) / (L2 + .05).
 */

export type Rgb = { r: number; g: number; b: number };
export type Rgba = Rgb & { a: number };

/** A gradient stop: a CSS colour and its position in percent (0-100). */
export type Stop = readonly [color: string, at: number];

/** Parses `#rgb`, `#rrggbb`, `rgb(...)` and `rgba(...)`. Throws on anything else. */
export function parseColor(css: string): Rgba {
  const value = css.trim().toLowerCase();
  if (value === '#fff' || value === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (fn) {
    const [r, g, b, a = '1'] = fn[1].split(',').map((p) => p.trim());
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  }
  throw new Error(`Unparseable colour: ${css}`);
}

/** Composites a possibly-translucent colour over an opaque backdrop. */
export function over(fg: string, bg: Rgb): Rgb {
  const c = parseColor(fg);
  return {
    r: c.r * c.a + bg.r * (1 - c.a),
    g: c.g * c.a + bg.g * (1 - c.a),
    b: c.b * c.a + bg.b * (1 - c.a),
  };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour a CSS linear gradient paints at `at` percent (sRGB interpolation, as browsers do for hex stops). */
export function sampleStops(stops: readonly Stop[], at: number): Rgb {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (at <= first[1]) return parseColor(first[0]);
  if (at >= last[1]) return parseColor(last[0]);
  for (let i = 1; i < stops.length; i += 1) {
    const [toColor, toAt] = stops[i];
    const [fromColor, fromAt] = stops[i - 1];
    if (at <= toAt) {
      const t = toAt === fromAt ? 1 : (at - fromAt) / (toAt - fromAt);
      const from = parseColor(fromColor);
      const to = parseColor(toColor);
      return { r: from.r + (to.r - from.r) * t, g: from.g + (to.g - from.g) * t, b: from.b + (to.b - from.b) * t };
    }
  }
  return parseColor(last[0]);
}

/** Serialises stops back into the `linear-gradient(180deg, …)` the components paint. */
export function toLinearGradient(stops: readonly Stop[]): string {
  return `linear-gradient(180deg,${stops.map(([c, at]) => `${c} ${at}%`).join(',')})`;
}

/**
 * The lowest contrast `text` reaches anywhere in the `[from, to]` percent band
 * of a gradient, optionally through translucent surfaces layered on top (a
 * glass card, a frosted pill) — innermost last. Sampled every half percent,
 * which is finer than a single text line on any phone.
 */
export function worstContrast(text: string, stops: readonly Stop[], from: number, to: number, surfaces: readonly string[] = []): number {
  let worst = Infinity;
  for (let at = from; at <= to + 1e-9; at += 0.5) {
    const backdrop = surfaces.reduce<Rgb>((bg, s) => over(s, bg), sampleStops(stops, at));
    worst = Math.min(worst, contrast(over(text, backdrop), backdrop));
  }
  return worst;
}

/** HSL hue (0-360), saturation and lightness (0-1) — used to spot an off-brand cool accent. */
export function hsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}
