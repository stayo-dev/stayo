/**
 * The mobile `BottomSheet` → desktop mapping, by *purpose* rather than by a
 * blanket "sheet becomes dialog" rule.
 *
 * The mobile app already differentiates these — a multi-step Invite wizard, a
 * one-tap Tenant Actions menu, and a "why is this tenant here" explainer are all
 * `BottomSheet` today but want three different desktop shapes. This is the pure
 * decision table; `<AdaptiveSurface>` renders whichever primitive it names.
 *
 *   wizard   — a self-contained multi-step task        → centered dialog
 *   form     — one focused action, context matters     → right-side drawer
 *   menu     — a short list of actions                 → dropdown menu
 *   picker   — choose one/many from a list             → popover
 *   explain  — read-only "why / details"              → popover
 *   confirm  — a yes/no, often destructive             → centered alert dialog
 *   preview  — a document / image / receipt            → large centered dialog
 */
export type SurfaceVariant = 'wizard' | 'form' | 'menu' | 'picker' | 'explain' | 'confirm' | 'preview';

export type SurfacePrimitive = 'bottom-sheet' | 'dialog' | 'drawer' | 'dropdown' | 'popover';

const DESKTOP_PRIMITIVE: Record<SurfaceVariant, SurfacePrimitive> = {
  wizard: 'dialog',
  form: 'drawer',
  menu: 'dropdown',
  picker: 'popover',
  explain: 'popover',
  confirm: 'dialog',
  preview: 'dialog',
};

/** Below the desktop breakpoint every variant is a bottom sheet — today's behaviour, unchanged. */
export function surfaceForVariant(variant: SurfaceVariant, isMobile: boolean): SurfacePrimitive {
  return isMobile ? 'bottom-sheet' : DESKTOP_PRIMITIVE[variant];
}

/** Desktop width hint per primitive, for the caller that wants one. */
export const SURFACE_WIDTH: Record<Exclude<SurfacePrimitive, 'bottom-sheet' | 'dropdown' | 'popover'>, string> = {
  dialog: 'sm:max-w-[560px]',
  drawer: 'sm:max-w-[420px]',
};
