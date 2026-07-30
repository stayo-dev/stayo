import type { ReactNode } from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { X } from 'lucide-react';
import { cn } from '@shared/lib/cn';

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Skip the title+close row (drag handle still renders) — for sheets that render their own custom header inline, per their own design spec. */
  hideHeader?: boolean;
}

/**
 * The one modal shell used everywhere across the design source (Invite
 * Tenant, Quick Collect, Add Room/Floor, Room Sheet, Tenant Actions, Config's
 * search overlay, Discover's filter/verify sheets — confirmed the same shape
 * in all three product-app files). Built directly on `vaul` (already a
 * dependency) rather than importing app/components/ui/drawer.tsx — shared/
 * code is architecturally forbidden from depending on app/ code (enforced by
 * scripts/check-architecture.mjs), so this is a small self-contained copy of
 * that primitive's scrim/drag-handle mechanics, not a duplicate abstraction.
 */
export function BottomSheet({ open, onOpenChange, title, children, footer, hideHeader }: BottomSheetProps) {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DrawerPrimitive.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-[22px] bg-card',
            'pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-12px_32px_rgba(42,37,33,0.18)]',
          )}
        >
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted" />
          {hideHeader ? (
            <DrawerPrimitive.Title className="sr-only">{title}</DrawerPrimitive.Title>
          ) : (
            <div className="flex items-center justify-between px-4 pt-3">
              <DrawerPrimitive.Title className="font-display text-lg font-bold text-foreground">
                {title}
              </DrawerPrimitive.Title>
              <DrawerPrimitive.Close className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
                <X className="h-4 w-4" />
              </DrawerPrimitive.Close>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && <div className="border-t border-border p-4">{footer}</div>}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
