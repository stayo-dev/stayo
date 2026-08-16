/**
 * The admin console's palette, taken verbatim from `Stayo Admin.dc.html`.
 *
 * These are literal hex values rather than theme tokens on purpose: the admin
 * console is a distinct visual surface from the owner and tenant apps, and
 * routing it through the shared token set would make a change intended for
 * owners silently restyle the console.
 */
export const ADMIN_PALETTE = Object.freeze({
  canvas: '#EFE9E2',
  grid: '#E3D8CB',
  sidebar: '#201C18',
  topbar: '#F7F3EF',
  card: '#FFFFFF',
  cardBorder: '#EFE6DA',
  hairline: '#F2ECE5',
  ink: '#221E1A',
  body: '#5A5147',
  muted: '#8A7F75',
  faint: '#A2978B',
  accent: '#B46A55',
  accentDark: '#9C5341',
  accentTint: '#F5E9E3',
  green: '#1F7A52',
  greenTint: '#EAF3EE',
  amber: '#B8792B',
  amberTint: '#FBF1DE',
  red: '#B3402F',
  redTint: '#FBEFE9',
  blue: '#3B5B9E',
  blueTint: '#EAF0FB',
} as const);

/** The design's card treatment, repeated on every panel. */
export const ADMIN_CARD =
  'rounded-[18px] border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,.04),0_6px_16px_rgba(40,30,20,.05)]';

/**
 * Row tints used for owner/lead avatars. Chosen by a deterministic hash of the
 * row id rather than by list position, so a row keeps its colour across
 * refetches, filtering and pagination.
 */
export const ADMIN_TINTS = ['#B46A55', '#3B5B9E', '#1F7A52', '#B8792B', '#8A7F75'] as const;

export function tintForId(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
  return ADMIN_TINTS[sum % ADMIN_TINTS.length];
}
