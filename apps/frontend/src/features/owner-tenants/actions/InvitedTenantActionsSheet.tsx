import {
  User,
  BedDouble,
  IndianRupee,
  Send,
  Copy,
  XCircle,
  Pencil,
  Building2,
  CalendarClock,
} from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

interface InvitedTenantActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onEditTenant: () => void;
  onEditStay: () => void;
  onEditFinancials: () => void;
  onResendInvitation: () => void;
  onCopyLink: () => void;
  onCancelInvitation: () => void;
}

export function InvitedTenantActionsSheet({
  open,
  onClose,
  onEditTenant,
  onEditStay,
  onEditFinancials,
  onResendInvitation,
  onCopyLink,
  onCancelInvitation,
}: InvitedTenantActionsSheetProps) {
  const handleAction = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title="Manage Invitation">
      <div className="flex flex-col gap-4">
        {/* Tenant Section */}
        <div className="flex flex-col gap-1.5">
          <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Tenant</span>
          <button
            type="button"
            onClick={() => handleAction(onEditTenant)}
            className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-left active:scale-[0.99] transition-transform"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card shadow-sm">
              <User className="h-4.5 w-4.5 text-foreground" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-foreground">Edit Personal Details</div>
              <div className="text-[11px] text-muted-foreground">Update name or phone number</div>
            </div>
            <Pencil className="h-4 w-4 text-muted-foreground/60" strokeWidth={1.8} />
          </button>
        </div>

        {/* Stay & Financial Setup Section */}
        <div className="flex flex-col gap-1.5">
          <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Stay Configuration</span>
          <button
            type="button"
            onClick={() => handleAction(onEditStay)}
            className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-left active:scale-[0.99] transition-transform"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card shadow-sm">
              <BedDouble className="h-4.5 w-4.5 text-foreground" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-foreground">Change Hostel or Room</div>
              <div className="text-[11px] text-muted-foreground">Assign available bed or change hostel</div>
            </div>
            <Pencil className="h-4 w-4 text-muted-foreground/60" strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => handleAction(onEditFinancials)}
            className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-left active:scale-[0.99] transition-transform"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card shadow-sm">
              <IndianRupee className="h-4.5 w-4.5 text-foreground" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-foreground">Change Rent &amp; Deposit</div>
              <div className="text-[11px] text-muted-foreground">Revise pre-activation tenancy terms</div>
            </div>
            <Pencil className="h-4 w-4 text-muted-foreground/60" strokeWidth={1.8} />
          </button>
        </div>

        {/* Invitation Management */}
        <div className="flex flex-col gap-1.5">
          <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Invitation Link</span>
          <button
            type="button"
            onClick={() => handleAction(onResendInvitation)}
            className="flex items-center gap-3 rounded-2xl bg-primary p-3.5 text-left text-primary-foreground shadow-sm active:scale-[0.99] transition-transform"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-white/15">
              <Send className="h-4.5 w-4.5 text-primary-foreground" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-primary-foreground">Resend Invitation</div>
              <div className="text-[11px] text-primary-foreground/80">Send link via WhatsApp / SMS</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleAction(onCopyLink)}
            className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-left active:scale-[0.99] transition-transform"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card shadow-sm">
              <Copy className="h-4.5 w-4.5 text-foreground" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-foreground">Copy Invitation Link</div>
              <div className="text-[11px] text-muted-foreground">Copy token URL to clipboard</div>
            </div>
          </button>
        </div>

        {/* Danger Zone */}
        <div className="flex flex-col gap-1.5 pt-1">
          <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-destructive">Danger Zone</span>
          <button
            type="button"
            onClick={() => handleAction(onCancelInvitation)}
            className="flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-3.5 text-left active:scale-[0.99] transition-transform"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-destructive/10">
              <XCircle className="h-4.5 w-4.5 text-destructive" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-destructive">Cancel Invitation</div>
              <div className="text-[11px] text-muted-foreground">Revoke pending link &amp; retain record for 30 days</div>
            </div>
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
