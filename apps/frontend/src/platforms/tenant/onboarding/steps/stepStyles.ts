/**
 * Shared class-name constants for the tenant activation step bodies.
 *
 * Mirrors the pattern already established in
 * `features/owner-onboarding/components/stepStyles.ts` — kept as a local copy
 * rather than a cross-feature import, since these are feature-scoped by
 * convention in this codebase and the two flows' visual language can diverge.
 */

export const eyebrow = 'text-xs font-bold uppercase tracking-wider text-primary';
export const h1 = 'mt-1 text-2xl font-black tracking-tight text-foreground';
export const sub = 'mt-1.5 text-sm text-muted-foreground';
export const fieldLabel = 'text-xs font-semibold text-muted-foreground';
export const fieldClass =
  'mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-muted/40 disabled:text-muted-foreground';
export const okNote = 'mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-success';
export const errorNote = 'mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-destructive';
