/**
 * Stayo Discover's visual vocabulary, lifted from the `Stayo Discover.dc.html`
 * prototype.
 *
 * Hard-coded hex rather than theme tokens, deliberately and for the same
 * reason as `WelcomePage`/`StayoLoadingScreen`: Discover renders outside any
 * `[data-app-theme]` shell — it is a public surface a signed-out visitor can
 * land on — so there is no token scope to inherit from. Keeping the values in
 * one module is what stops eight screens drifting into eight slightly
 * different terracottas.
 *
 * Manrope and Inter are already loaded by `index.html`, so naming them costs
 * no extra font request.
 */

export const C = {
  /** Near-black brand ground. Headers, primary dark surfaces. */
  ink: '#221E1A',
  inkSoft: '#2A2521',

  /** Terracotta — the brand accent, in the four weights the prototype uses. */
  clay: '#B46A55',
  clayDeep: '#A45D44',
  clayLight: '#D9906F',
  clayPale: '#E7A986',

  /** Paper grounds. */
  paper: '#F7F3EF',
  paperWarm: '#F5EEE6',
  card: '#FFFFFF',
  cardWarm: '#FFFDFB',

  /** Hairlines, in the order the prototype reaches for them. */
  line: '#EFE6DA',
  lineSoft: '#F2ECE5',
  lineInput: '#E7DDD1',

  /** Text. */
  text: '#221E1A',
  textBody: '#4A433C',
  textMuted: '#8A7F75',
  textFaint: '#9A8F84',
  textGhost: '#B0A597',

  /** Semantic. */
  green: '#1F7A52',
  greenBright: '#4FA97C',
  greenPale: '#EAF3EE',
  amber: '#B8792B',
  amberPale: '#FBF1DE',
  clayPaleBg: '#F5E9E3',
  chipBg: '#F5EFE8',
} as const;

export const FONT = {
  display: "'Manrope',sans-serif",
  body: "'Inter',system-ui,sans-serif",
} as const;

/** The placeholder texture standing in for a photo that hasn't been uploaded. */
export const PHOTO_FALLBACK = {
  backgroundColor: '#E7D9CC',
  backgroundImage: 'repeating-linear-gradient(135deg,rgba(255,255,255,.4) 0 1px,transparent 1px 12px)',
} as const;

/** Graph-paper ground, shared with `/` and `/owners`. */
export const GRID_GROUND = {
  backgroundColor: C.paper,
  backgroundImage:
    'linear-gradient(#EBDCCF 1px,transparent 1px),linear-gradient(90deg,#EBDCCF 1px,transparent 1px)',
  backgroundSize: '52px 52px',
} as const;

/** `hostels.hostel_type` → what a person would actually call it. */
export const AUDIENCE_LABEL: Record<string, string> = {
  BOYS: 'Boys',
  GIRLS: 'Girls',
  CO_LIVING: 'Co-ed',
  WORKING_PROS: 'Working professionals',
};

/**
 * Indian digit grouping — ₹1,20,000, not ₹120,000. `en-IN` gets the lakh/crore
 * grouping right where a generic locale does not.
 */
export function formatRupees(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/**
 * A hostel with no priced room shows "Price on request", never "₹0" — an
 * unpriced room means the owner hasn't said, not that the bed is free.
 */
export function priceLabel(startingPrice: number | null): string | null {
  return startingPrice == null ? null : `₹${formatRupees(startingPrice)}`;
}

/** "2-bed · 4-bed · 6-bed" from room capacities. */
export function sharingLabels(sharing: number[]): string[] {
  return sharing.map((capacity) => (capacity === 1 ? 'Single' : `${capacity}-bed`));
}
