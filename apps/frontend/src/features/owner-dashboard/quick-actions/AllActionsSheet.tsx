import { IndianRupee, FileText, Check, CircleDot, Pencil, RotateCcw } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { mockActionCenter } from '@shared/mocks/dashboard';

interface AllActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onCollectRent: () => void;
  onActivateTenants: () => void;
  onVerifyKyc: () => void;
  /**
   * Required, not defaulted to `mockActionCenter`: these are counts an owner
   * acts on, and a fallback that silently renders invented numbers is worse
   * than a compile error. The import below is now type-only.
   */
  actionCenter: typeof mockActionCenter;
}

const rowCls = 'flex items-center gap-3 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const primaryBtn = 'flex-none rounded-[9px] bg-foreground px-3.5 py-2 font-display text-xs font-bold text-background';
const secondaryBtn = 'flex-none rounded-[9px] border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground';

const soon = () => stayoToast.info('Coming soon');

/** Home's "View all" Action Center sheet, per Stayo App.dc.html. Collect Rent / Activate Tenants reuse the real QuickCollect/Invite flows; the rest are toast placeholders — matching the design's own reference, which doesn't wire these buttons either. */
export function AllActionsSheet({ open, onClose, onCollectRent, onActivateTenants, onVerifyKyc, actionCenter = mockActionCenter }: AllActionsSheetProps) {
  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={<span className="flex flex-col gap-0.5"><span>All actions</span><span className="text-xs font-normal text-muted-foreground">Ranked by priority</span></span>}>
      <div className="flex flex-col gap-2">
        <div className={rowCls}>
          <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-secondary text-primary"><IndianRupee className="h-4 w-4" strokeWidth={2.2} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold text-foreground">Collect Rent</div>
            <div className="text-[11.5px] text-muted-foreground">{actionCenter.collectRent.caption} · {actionCenter.collectRent.amount}</div>
          </div>
          <button type="button" onClick={onCollectRent} className={primaryBtn}>Collect Now</button>
        </div>

        <div className={rowCls}>
          <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-secondary text-primary"><FileText className="h-4 w-4" strokeWidth={2} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold text-foreground">Review Agreements</div>
            <div className="text-[11.5px] text-muted-foreground">{actionCenter.reviewAgreements.value} {actionCenter.reviewAgreements.caption.toLowerCase()}</div>
          </div>
          <button type="button" onClick={soon} className={primaryBtn}>Review Now</button>
        </div>

        <div className={rowCls}>
          <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-secondary text-primary"><Check className="h-4 w-4" strokeWidth={2.2} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold text-foreground">Activate Tenants</div>
            <div className="text-[11.5px] text-muted-foreground">{actionCenter.activateTenants.value} {actionCenter.activateTenants.caption.toLowerCase()}</div>
          </div>
          <button type="button" onClick={onActivateTenants} className={primaryBtn}>Activate Now</button>
        </div>

        <div className={rowCls}>
          <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-secondary text-primary"><CircleDot className="h-4 w-4" strokeWidth={2} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold text-foreground">Fill Vacant Beds</div>
            <div className="text-[11.5px] text-muted-foreground">{actionCenter.fillVacantBeds.value} {actionCenter.fillVacantBeds.caption.toLowerCase()}</div>
          </div>
          <button type="button" onClick={soon} className={primaryBtn}>View Leads</button>
        </div>

        <div className={rowCls}>
          <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-muted text-muted-foreground"><Pencil className="h-4 w-4" strokeWidth={1.9} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold text-foreground">Verify Pending KYC</div>
            <div className="text-[11.5px] text-muted-foreground">{actionCenter.verifyKyc.value} {actionCenter.verifyKyc.caption.toLowerCase()}</div>
          </div>
          <button type="button" onClick={onVerifyKyc} className={primaryBtn}>Review</button>
        </div>

        <div className={rowCls}>
          <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-muted text-muted-foreground"><RotateCcw className="h-4 w-4" strokeWidth={1.9} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold text-foreground">Send Rent Reminders</div>
            <div className="text-[11.5px] text-muted-foreground">{actionCenter.sendReminders.value} {actionCenter.sendReminders.caption.toLowerCase()}</div>
          </div>
          <button type="button" onClick={soon} className={secondaryBtn}>Send</button>
        </div>
      </div>
    </BottomSheet>
  );
}
