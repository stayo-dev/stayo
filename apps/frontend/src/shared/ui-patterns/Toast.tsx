import { toast as sonnerToast } from 'sonner';
import { CheckCircle2, AlertCircle, Info, Undo2 } from 'lucide-react';

/**
 * StayO's dark-pill toast (bottom-anchored, 2.4s auto-dismiss per the design
 * source — used identically for confirmations and "coming soon" placeholders
 * across every product-app screen). Calls the sonner `toast()` already
 * mounted by ProtectedAppProviders/AuthShellProviders — no second <Toaster/>
 * needed. Distinct from the legacy `hmsToast` (lib/toast.ts), which keeps
 * its own light-themed styling for not-yet-migrated legacy screens; both
 * coexist per the same reasoning as the two design-token sets.
 */
const TOAST_CLASSNAMES = {
  toast: 'rounded-full! bg-foreground! text-background! border-none! px-4! py-2.5! shadow-lg!',
  title: 'text-sm! font-semibold!',
};

export const stayoToast = {
  success: (message: string) =>
    sonnerToast(message, { icon: <CheckCircle2 className="h-4 w-4" />, classNames: TOAST_CLASSNAMES, duration: 2400 }),
  error: (message: string) =>
    sonnerToast(message, { icon: <AlertCircle className="h-4 w-4" />, classNames: TOAST_CLASSNAMES, duration: 2400 }),
  info: (message: string) =>
    sonnerToast(message, { icon: <Info className="h-4 w-4" />, classNames: TOAST_CLASSNAMES, duration: 2400 }),
  /** Dark pill with a single inline Undo. Longer-lived than the others — an undo the user can't reach is not an undo. */
  undo: (message: string, onUndo: () => void) =>
    sonnerToast(message, {
      icon: <Undo2 className="h-4 w-4" />,
      classNames: TOAST_CLASSNAMES,
      duration: 6000,
      action: { label: 'Undo', onClick: onUndo },
    }),
};
