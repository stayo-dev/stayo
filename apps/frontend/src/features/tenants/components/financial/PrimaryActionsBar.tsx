import { useState } from 'react';
import { IndianRupee, ReceiptText, Share2, FileStack, ChevronDown, X, MoreHorizontal, FileCheck2, TrendingUp, CalendarRange, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { paymentService } from '@features/payments/api';
import { hmsToast } from '@lib/toast';
import { sharePaymentLink } from '@lib/share';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/app/components/ui/dropdown-menu';

interface PrimaryAction {
  key: string;
  label: string;
  icon: typeof IndianRupee;
  onClick: () => void;
  emphasis?: boolean;
}

interface PrimaryActionsBarProps {
  tenantId: string;
  tenantPhone?: string;
  onReceivePayment: () => void;
  onCreateCharge: () => void;
  onViewReceipts: () => void;
  onRequestChange: () => void;
  requestChangeLabel: string;
  onChangeRent: () => void;
  canChangeRent: boolean;
  onChangeFrequency: () => void;
  canChangeFrequency: boolean;
  onCheckout: () => void;
  receiveLabel?: string;
}

export function PrimaryActionsBar({
  tenantId,
  tenantPhone,
  onReceivePayment,
  onCreateCharge,
  onViewReceipts,
  onRequestChange,
  requestChangeLabel,
  onChangeRent,
  canChangeRent,
  onChangeFrequency,
  canChangeFrequency,
  onCheckout,
  receiveLabel = 'Receive Payment',
}: PrimaryActionsBarProps) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSharePaymentLink = async () => {
    try {
      const res = await paymentService.generatePayLink({ tenantId });
      const paymentLink = res.url;
      const copied = await sharePaymentLink(`Here is your payment link: ${paymentLink}`, paymentLink, tenantPhone);
      toast.success(copied ? 'Link copied — opening WhatsApp' : 'Opening WhatsApp');
    } catch (e: any) {
      hmsToast.error(e, 'Generate payment link');
    }
  };

  const receiveAction: PrimaryAction = { key: 'receive', label: receiveLabel, icon: IndianRupee, onClick: onReceivePayment, emphasis: true };
  const shareLinkAction: PrimaryAction = { key: 'link', label: 'Share Payment Link', icon: Share2, onClick: handleSharePaymentLink };

  const secondaryActions: PrimaryAction[] = [
    { key: 'charge', label: 'Create Charge', icon: ReceiptText, onClick: onCreateCharge },
    { key: 'receipts', label: 'View Receipts', icon: FileStack, onClick: onViewReceipts },
  ];

  const agreementActions: PrimaryAction[] = [
    { key: 'request-change', label: requestChangeLabel, icon: FileCheck2, onClick: onRequestChange },
    ...(canChangeRent ? [{ key: 'change-rent', label: 'Change Rent', icon: TrendingUp, onClick: onChangeRent }] : []),
    ...(canChangeFrequency ? [{ key: 'change-frequency', label: 'Change Billing Frequency', icon: CalendarRange, onClick: onChangeFrequency }] : []),
  ];

  const lifecycleActions: PrimaryAction[] = [
    { key: 'checkout', label: 'Check-out / Exit', icon: LogOut, onClick: onCheckout },
  ];

  // Desktop "More" dropdown keeps all non-primary, non-secondary actions in one flat menu.
  const overflowActions: PrimaryAction[] = [shareLinkAction, ...agreementActions];

  const sheetGroups: { label: string; actions: PrimaryAction[] }[] = [
    { label: 'Collect', actions: [receiveAction, shareLinkAction] },
    { label: 'Charges & Receipts', actions: secondaryActions },
    { label: 'Agreement', actions: agreementActions },
    { label: 'Tenancy', actions: lifecycleActions },
  ];

  if (isMobile) {
    return (
      <div id="fin-actions" className="scroll-mt-20">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-accent text-accent-foreground text-sm font-bold active:scale-98 transition-transform shadow-sm"
        >
          <IndianRupee className="w-4 h-4" />
          <span>Actions</span>
          <ChevronDown className="w-4 h-4" />
        </button>

        {sheetOpen && (
          <div className="fixed inset-0 z-50 flex items-end bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="w-full rounded-t-3xl border-t border-border bg-card p-4 pb-6 shadow-2xl animate-in slide-in-from-bottom duration-200 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-foreground">Actions</h3>
                <button type="button" onClick={() => setSheetOpen(false)} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                {sheetGroups.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                    {group.actions.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        onClick={() => {
                          setSheetOpen(false);
                          action.onClick();
                        }}
                        className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold active:scale-98 transition-transform ${
                          action.emphasis ? 'bg-accent text-accent-foreground' : 'bg-secondary text-foreground border border-border'
                        }`}
                      >
                        <action.icon className="w-4 h-4" />
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="fin-actions" className="flex flex-wrap gap-2 scroll-mt-20">
      <button
        type="button"
        onClick={onReceivePayment}
        className="flex-1 min-w-[150px] flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm bg-accent text-accent-foreground hover:bg-accent/90"
      >
        <IndianRupee className="w-4 h-4" />
        <span>{receiveLabel}</span>
      </button>

      {secondaryActions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onClick}
          className="flex-1 min-w-[150px] flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm bg-secondary text-foreground border border-border hover:bg-secondary/80"
        >
          <action.icon className="w-4 h-4" />
          <span>{action.label}</span>
        </button>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm bg-secondary text-foreground border border-border hover:bg-secondary/80"
          >
            <MoreHorizontal className="w-4 h-4" />
            <span>More</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {overflowActions.map((action) => (
            <DropdownMenuItem key={action.key} onSelect={action.onClick} className="gap-2 cursor-pointer">
              <action.icon className="w-4 h-4" />
              <span>{action.label}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {lifecycleActions.map((action) => (
            <DropdownMenuItem key={action.key} onSelect={action.onClick} className="gap-2 cursor-pointer">
              <action.icon className="w-4 h-4" />
              <span>{action.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
