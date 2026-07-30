import {
  Phone,
  MessageCircle,
  Copy,
  User,
  Share2,
  AlertCircle,
  Bell,
  Send,
} from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/app/components/ui/drawer';
import type { NormalizedTenant } from '@features/tenants/utils/normalize';
import type { useTenantActions } from '@features/tenants/hooks/useTenantActions';

interface TenantCardMoreSheetProps {
  open: boolean;
  onClose: () => void;
  tenant: NormalizedTenant;
  actions: ReturnType<typeof useTenantActions>;
  onSelect: () => void;
  onCollect?: () => void;
  onReminder?: () => void;
  onResend?: () => void;
}

export function TenantCardMoreSheet({
  open,
  onClose,
  tenant,
  actions,
  onSelect,
  onCollect,
  onReminder,
  onResend,
}: TenantCardMoreSheetProps) {
  const handleAction = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="p-4 pb-8">
        <DrawerHeader className="text-left px-0 pb-3">
          <DrawerTitle className="text-lg font-bold text-foreground">
            {tenant.name}
          </DrawerTitle>
          <DrawerDescription className="text-xs text-muted-foreground">
            Room {tenant.room} · Operations &amp; Communications
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-1.5 mt-2">
          {/* Main profile navigation */}
          <button
            type="button"
            onClick={() => handleAction(onSelect)}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-accent/5 hover:bg-accent/10 text-foreground transition-colors font-medium text-left"
          >
            <User className="w-5 h-5 text-accent shrink-0" />
            <span>Open Operations Dashboard</span>
          </button>

          {/* Quick Collect if unpaid */}
          {onCollect && tenant.outstandingAmount > 0 && (
            <button
              type="button"
              onClick={() => handleAction(onCollect)}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 transition-colors font-semibold text-left"
            >
              <Share2 className="w-5 h-5 shrink-0" />
              <span>Record Rent Payment</span>
            </button>
          )}

          {/* Call */}
          <button
            type="button"
            onClick={() => handleAction(() => actions.callTenant(tenant.phone))}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-secondary text-foreground transition-colors font-medium text-left"
          >
            <Phone className="w-5 h-5 text-muted-foreground shrink-0" />
            <span>Call Tenant</span>
          </button>

          {/* WhatsApp */}
          <button
            type="button"
            onClick={() => handleAction(() => actions.whatsAppTenant(tenant.phone))}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-secondary text-foreground transition-colors font-medium text-left"
          >
            <MessageCircle className="w-5 h-5 text-emerald-500 shrink-0" />
            <span>Send WhatsApp Message</span>
          </button>

          {/* Copy Phone */}
          <button
            type="button"
            onClick={() => handleAction(() => actions.copyPhone(tenant.phone))}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-secondary text-foreground transition-colors font-medium text-left"
          >
            <Copy className="w-5 h-5 text-muted-foreground shrink-0" />
            <span>Copy Phone Number</span>
          </button>

          {/* Share Payment Link — available regardless of outstanding dues */}
          <button
            type="button"
            onClick={() =>
              handleAction(() =>
                actions.sharePaymentLink(tenant.id, tenant.phone, tenant.outstandingAmount)
              )
            }
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-secondary text-foreground transition-colors font-medium text-left"
          >
            <Share2 className="w-5 h-5 text-indigo-500 shrink-0" />
            <span>Share Payment Link</span>
          </button>

          {/* Remind / Resend Invite */}
          {onReminder && tenant.status === 'ACTIVE' && (
            <button
              type="button"
              onClick={() => handleAction(() => onReminder(tenant))}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-secondary text-foreground transition-colors font-medium text-left"
            >
              <Bell className="w-5 h-5 text-amber-500 shrink-0" />
              <span>Send Payment Reminder</span>
            </button>
          )}

          {onResend && tenant.status === 'INVITED' && (
            <button
              type="button"
              onClick={() => handleAction(() => onResend(tenant))}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-colors font-medium text-left"
            >
              <Send className="w-5 h-5 shrink-0" />
              <span>Resend Invitation</span>
            </button>
          )}

          {/* Terminate (Direct Left check) */}
          {tenant.status !== 'INACTIVE' && (
            <button
              type="button"
              onClick={() => handleAction(actions.blockDirectLeft)}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-950/20 dark:text-rose-400 transition-colors font-medium text-left border-t border-border/40 mt-3 pt-4"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Mark as Left (Check Dues)</span>
            </button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
