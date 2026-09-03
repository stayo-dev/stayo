import type { ReactNode } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useIsMobile } from './use-mobile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './sheet';
import { surfaceForVariant, SURFACE_WIDTH } from './adaptiveSurface';

/**
 * One JSX tree, the right container for the viewport and the job.
 *
 * Below `md` (`useIsMobile`) every variant is the app's shared `BottomSheet` —
 * today's behaviour, untouched. On a desktop viewport the variant chooses:
 *
 *   wizard / confirm / preview → centered `Dialog`
 *   form                       → right-side `Sheet` (context stays visible)
 *
 * `menu`, `picker` and `explain` from `adaptiveSurface.ts` are deliberately not
 * handled here — a dropdown/popover needs an anchor element and belongs at the
 * call site (`DropdownMenu` / a popover), not in a modal container. Introduced
 * for Phase 2's sheet conversions; nothing imports it yet.
 */
export type AdaptiveSurfaceVariant = 'wizard' | 'form' | 'confirm' | 'preview';

interface AdaptiveSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: AdaptiveSurfaceVariant;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Hide the title row (the body renders its own). Bottom-sheet + dialog both honour it. */
  hideHeader?: boolean;
}

export function AdaptiveSurface({
  open,
  onOpenChange,
  variant,
  title,
  description,
  children,
  footer,
  hideHeader,
}: AdaptiveSurfaceProps) {
  const isMobile = useIsMobile();
  const primitive = surfaceForVariant(variant, isMobile);

  if (primitive === 'bottom-sheet') {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title={title} footer={footer} hideHeader={hideHeader}>
        {children}
      </BottomSheet>
    );
  }

  if (primitive === 'drawer') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className={`w-full ${SURFACE_WIDTH.drawer}`}>
          {!hideHeader && (
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              {description && <SheetDescription>{description}</SheetDescription>}
            </SheetHeader>
          )}
          <div className="flex-1 overflow-y-auto px-4">{children}</div>
          {footer && <SheetFooter>{footer}</SheetFooter>}
        </SheetContent>
      </Sheet>
    );
  }

  // dialog — wizard / confirm / preview
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={variant === 'preview' ? 'sm:max-w-3xl' : SURFACE_WIDTH.dialog}>
        {!hideHeader && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
