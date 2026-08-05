import { IndianRupee, UserPlus, Receipt, Utensils } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

interface QuickActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onCollectPayment: () => void;
  onInviteTenant: () => void;
  onAddExpense: () => void;
  onCreateFoodPoll: () => void;
}

const rowCls = 'flex items-center gap-2.5 rounded-[13px] border border-border bg-card px-3 py-2.5 text-left';
const iconCls = 'flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg bg-secondary text-primary';

/** Home FAB's Quick Actions menu, per Stayo App.dc.html's 3-item modal — Food menu added as a 4th, per explicit request. */
export function QuickActionsSheet({ open, onClose, onCollectPayment, onInviteTenant, onAddExpense, onCreateFoodPoll }: QuickActionsSheetProps) {
  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title="Quick actions">
      <div className="flex flex-col gap-2">
        <button type="button" onClick={onCollectPayment} className={rowCls}>
          <span className={iconCls}><IndianRupee className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Collect Payment</span>
        </button>
        <button type="button" onClick={onInviteTenant} className={rowCls}>
          <span className={iconCls}><UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Add Tenant</span>
        </button>
        <button type="button" onClick={onAddExpense} className={rowCls}>
          <span className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg bg-muted text-muted-foreground"><Receipt className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Add Expense</span>
        </button>
        <button type="button" onClick={onCreateFoodPoll} className={rowCls}>
          <span className={iconCls}><Utensils className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          <span className="font-display text-[12.5px] font-bold text-foreground">Food menu</span>
        </button>
      </div>
    </BottomSheet>
  );
}
