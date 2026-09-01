import { IndianRupee, UserPlus, Receipt } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

interface QuickActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onCollectPayment: () => void;
  onInviteTenant: () => void;
  onAddExpense: () => void;
  /**
   * Whether a hostel exists to act on. Every action in this sheet needs one:
   * you cannot collect rent, invite a tenant, or file an expense against
   * nothing. They used to be offered regardless, so a brand-new owner's only
   * visible "+" button opened flows that could not succeed. See ADR-139.
   * (Hostel creation itself lives elsewhere: PropertyList's own "+ Add
   * hostel" button and the getting-started checklist.)
   */
  canOperate: boolean;
}

const rowCls = 'flex items-center gap-2.5 rounded-[13px] border border-border bg-card px-3 py-2.5 text-left';
const iconCls = 'flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg bg-secondary text-primary';

/** Home FAB's Quick Actions menu, per Stayo App.dc.html's original 3-item modal. */
export function QuickActionsSheet({
  open,
  onClose,
  onCollectPayment,
  onInviteTenant,
  onAddExpense,
  canOperate,
}: QuickActionsSheetProps) {
  // Dimmed rather than removed: seeing what the app will do once there is a
  // hostel is the point, and a row that silently vanishes teaches nothing.
  const gated = (handler: () => void) => (canOperate ? handler : undefined);
  const gatedCls = canOperate ? rowCls : `${rowCls} opacity-45`;

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title="Quick actions">
      <div className="flex flex-col gap-2">
        <button type="button" onClick={gated(onCollectPayment)} disabled={!canOperate} className={gatedCls}>
          <span className={iconCls}><IndianRupee className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Collect Payment</span>
        </button>
        <button type="button" onClick={gated(onInviteTenant)} disabled={!canOperate} className={gatedCls}>
          <span className={iconCls}><UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Add Tenant</span>
        </button>
        <button type="button" onClick={gated(onAddExpense)} disabled={!canOperate} className={gatedCls}>
          <span className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg bg-muted text-muted-foreground"><Receipt className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Add Expense</span>
        </button>
        {!canOperate && (
          <p className="px-1 pt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Rent, tenants and expenses open up once your first hostel exists.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
