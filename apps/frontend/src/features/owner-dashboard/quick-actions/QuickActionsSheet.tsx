import { IndianRupee, UserPlus, Receipt, Utensils, Building2 } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

interface QuickActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onCollectPayment: () => void;
  onInviteTenant: () => void;
  onAddExpense: () => void;
  onCreateFoodPoll: () => void;
  onAddHostel: () => void;
  /**
   * Whether a hostel exists to act on. Every other action in this sheet needs
   * one: you cannot collect rent, invite a tenant, file an expense or set a
   * menu against nothing. They used to be offered regardless, so a brand-new
   * owner's only visible "+" button opened four flows that could not succeed —
   * and none of them was the one thing they needed. See ADR-139.
   */
  canOperate: boolean;
}

const rowCls = 'flex items-center gap-2.5 rounded-[13px] border border-border bg-card px-3 py-2.5 text-left';
const iconCls = 'flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg bg-secondary text-primary';

/** Home FAB's Quick Actions menu, per Stayo App.dc.html's 3-item modal — Food menu added as a 4th, per explicit request. */
export function QuickActionsSheet({
  open,
  onClose,
  onCollectPayment,
  onInviteTenant,
  onAddExpense,
  onCreateFoodPoll,
  onAddHostel,
  canOperate,
}: QuickActionsSheetProps) {
  // Dimmed rather than removed: seeing what the app will do once there is a
  // hostel is the point, and a row that silently vanishes teaches nothing.
  const gated = (handler: () => void) => (canOperate ? handler : undefined);
  const gatedCls = canOperate ? rowCls : `${rowCls} opacity-45`;

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title="Quick actions">
      <div className="flex flex-col gap-2">
        {/* First while there is nothing else to do, and always present — this
            is one of only three ways into hostel creation in the whole app. */}
        {!canOperate && (
          <button type="button" onClick={onAddHostel} className={rowCls}>
            <span className={iconCls}><Building2 className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
            <span className="font-display text-[12.5px] font-bold text-foreground">Add Hostel</span>
          </button>
        )}
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
        <button type="button" onClick={gated(onCreateFoodPoll)} disabled={!canOperate} className={gatedCls}>
          <span className={iconCls}><Utensils className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Food menu</span>
        </button>
        {canOperate && (
          <button type="button" onClick={onAddHostel} className={rowCls}>
            <span className={iconCls}><Building2 className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
            <span className="font-display text-[12.5px] font-bold text-foreground">Add Hostel</span>
          </button>
        )}
        {!canOperate && (
          <p className="px-1 pt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Rent, tenants, expenses and the food menu open up once your first hostel exists.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
