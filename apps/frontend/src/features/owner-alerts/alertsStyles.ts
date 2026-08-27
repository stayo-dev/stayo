import { stayoToast } from '@shared/ui-patterns/Toast';

/** Shared row/button class strings for the Alerts feature — one copy so the four category pages and LeadCard read as the same visual language. */
export const rowCard =
  'flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
export const actionBtn = 'flex-1 rounded-[10px] bg-foreground py-2.5 text-center font-display text-[12.5px] font-bold text-background';
export const sideBtn = 'w-[70px] rounded-[10px] border border-border bg-card py-2.5 text-center text-[12.5px] font-semibold text-foreground';
/**
 * The lead card's secondary pair. Content-sized rather than a fixed 70px,
 * because "Chat" carries an icon and three buttons now share the row; and
 * `min-h` so shrinking them does not shrink the tap target.
 */
export const leadSideBtn =
  'inline-flex min-h-[40px] flex-none items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground';

export const initials = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export const soon = () => stayoToast.info('Coming soon');
