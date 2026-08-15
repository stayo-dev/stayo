/**
 * The accent hexes the `HOSTEL: MARKETING` design uses that the product token
 * set does not name.
 *
 * The palette proper already lives in `styles/tokens/product.css` — `--primary`
 * *is* the design's `#B46A55`, `--border` *is* `#EFE6DA`, `--muted-foreground`
 * *is* `#8A7F75` — so this module deliberately holds only what has no token:
 * the dark status card, the warm icon tiles, the separator that sits a shade
 * off `--border`, and the locked-review greys. Same reasoning as
 * `discoverTheme.ts`: one module is what stops nine files drifting into nine
 * slightly different terracottas.
 *
 * Use tokens (`bg-card`, `border-border`, `text-primary`) wherever one exists;
 * reach for these only for the values below.
 */

export const M = {
  /** The status card and the primary dark chips. */
  ink: '#2A2521',
  /** Text on the ink card, in the two weights the design uses. */
  inkText: '#B9AFA3',
  inkTextFaint: '#8C8177',

  /** The warm square behind every row icon. */
  iconTile: '#F3E9DF',

  /** Row separator inside cards — a shade warmer than `--border`. */
  rowLine: '#F3ECE4',

  /** Outline buttons ("Switch / reuse", "Preview", "Cancel"). */
  outline: '#DDD1C4',
  /** Text inside those outline buttons. */
  outlineText: '#4A433C',

  /** Dashed "Add" affordances. */
  dashed: '#CBBBA9',
  dashedBg: '#FBF7F2',
  dashedClay: '#C9A995',

  /** Faint metadata text, in the design's three steps. */
  faint: '#9C9186',
  ghost: '#B0A597',
  /** The `›` chevron that ends an editable row. */
  chevron: '#B08E6A',

  /** The locked "Resident reviews" card. */
  lockedBg: '#F4EEE7',
  lockedBorder: '#E7DDD1',
  lockedTile: '#E4D9CD',
  lockedText: '#5A5148',

  /** "Included"-style green badge on Basics rows. */
  greenBg: '#ECF4EF',
  greenText: '#2E7D5B',

  /** Sheet chrome: grab handle, close button, header rule. */
  grab: '#DDD2C6',
  closeBg: '#EFE7DE',
  closeText: '#6B6259',
  sheetLine: '#EAE1D8',
  sheetBg: '#F7F3EF',

  /** Inactive chips in the mess type / day rows. */
  chipBg: '#F1EBE3',
  chipText: '#6E6459',

  /** Input hairline where `--border` reads too warm against white. */
  inputLine: '#E7DBCE',
} as const;

export const MESS_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** The design's card shadow, on every white section of the page. */
export const CARD_SHADOW = '0 1px 2px rgba(40,30,20,.04), 0 6px 16px rgba(40,30,20,.05)';

/** The lighter shadow the preview screen and its inner cards use. */
export const SOFT_SHADOW = '0 1px 2px rgba(40,30,20,.04)';
