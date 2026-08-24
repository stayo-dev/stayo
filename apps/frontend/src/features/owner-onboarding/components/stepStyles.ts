/** Shared className tokens for the 12 onboarding step components — mirrors the
 * `eyebrow`/`h1`/`sub`/`fieldLabel`/etc. style-string constants built once per
 * render in Owner Onboarding.dc.html's script, translated to static Tailwind
 * classes since React doesn't need to rebuild style strings every render. */
export const eyebrow = 'mb-3.5 inline-block font-display text-[11px] font-bold tracking-[0.1em] text-[#B0806A]';
export const h1 = 'mb-2.5 font-display text-[clamp(28px,3.6vw,42px)] font-extrabold leading-[1.08] tracking-tight text-foreground';
export const sub = 'mb-7 max-w-[430px] text-base leading-relaxed text-muted-foreground';
export const fieldLabel = 'font-display text-xs font-bold tracking-wide text-primary';
/**
 * A field that looks like a field.
 *
 * This used to be a transparent box with a single `border-border` underline.
 * That token is ~1.1:1 against the page — fainter than the decorative
 * graph-paper grid behind these screens — so the inputs read as paragraphs of
 * text and owners could not tell there was anything to type into. Now: a solid
 * fill, a full `--field-border` edge at >=3:1, and a focus ring that states
 * plainly which field is live.
 *
 * `placeholder:font-normal` matters as much as the border did. At the same
 * weight as real input, "Sunrise Residency" reads as an answer already given
 * rather than an example.
 */
export const textInput =
  'mt-2 w-full rounded-xl border-[1.5px] border-field-border bg-input-background px-3.5 py-3 text-lg font-semibold text-foreground transition-colors placeholder:font-normal placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

/** `textInput` when the field has something wrong with it. */
export const textInputInvalid = 'border-destructive focus:border-destructive focus:ring-destructive/15';

/** The message under an invalid field. */
export const fieldError = 'mt-1.5 block text-[12.5px] font-semibold text-destructive';

/** Quiet guidance under a field — what it is for, not what went wrong. */
export const fieldHint = 'mt-1.5 block text-[12.5px] leading-relaxed text-muted-foreground';
export const okNote = 'mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-success';
/**
 * A labelled row with a control on the right.
 *
 * Stacks below `sm`: at 390px a long label ("Applied to every room — change
 * any room later") wrapped to two lines and collided with the ₹ input beside
 * it. `gap` rather than `justify-between` alone so the two halves never touch
 * once they sit on one line again.
 */
export const tile =
  'flex flex-col gap-2.5 rounded-2xl border border-border bg-card/90 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4.5';
export const tileTitle = 'font-display text-[15px] font-bold text-foreground';
export const tileSub = 'text-[12.5px] font-medium text-muted-foreground';
export const statCard = 'rounded-2xl border border-border bg-card/92 p-4.5';
export const statK = 'text-xs font-medium text-muted-foreground';
export const stepBtn =
  'flex h-9.5 w-9.5 items-center justify-center rounded-[11px] border border-border bg-card font-display text-xl font-bold leading-none text-primary transition-transform active:scale-90';
export const genBtn =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-foreground px-4.5 py-3 font-display text-sm font-bold text-background transition-transform active:scale-[0.97]';
