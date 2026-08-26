import {
  Landmark,
  Share2,
  Receipt,
  FileStack,
  RotateCcw,
  ArrowLeftRight,
  CalendarClock,
  BedDouble,
  LogOut,
} from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

interface TenantActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onCollectPayment: () => void;
  onChangeRent: () => void;
  onCheckout: () => void;
  onShareLink: () => void;
  onCreateCharge: () => void;
  onViewReceipts: () => void;
  onRequestChange: () => void;
  onChangeBilling: () => void;
  onChangeRoom: () => void;
}

const GROUPS: {
  label: string;
  rows: { icon: typeof Landmark; title: string; sub: string; key: string }[];
}[] = [
  {
    label: 'Collect',
    rows: [{ icon: Landmark, title: 'Receive Payment', sub: 'Log cash, UPI or bank transfer', key: 'collect' }],
  },
  {
    label: 'Charges & Receipts',
    rows: [
      { icon: Share2, title: 'Share Payment Link', sub: 'Send a secure pay link to tenant', key: 'share-link' },
      { icon: Receipt, title: 'Create Charge', sub: 'Add rent, deposit or one-off fee', key: 'create-charge' },
      { icon: FileStack, title: 'View Receipts', sub: 'All issued receipts & invoices', key: 'view-receipts' },
    ],
  },
  {
    label: 'Stay',
    rows: [
      { icon: BedDouble, title: 'Move Room', sub: 'Shift to a room with space', key: 'change-room' },
    ],
  },
  {
    label: 'Agreement',
    rows: [
      { icon: RotateCcw, title: 'Request Change', sub: "Ask tenant to re-sign terms", key: 'request-change' },
      { icon: ArrowLeftRight, title: 'Change Rent', sub: 'Revise monthly rent amount', key: 'change-rent' },
      { icon: CalendarClock, title: 'Change Billing Frequency', sub: 'Monthly, quarterly or yearly', key: 'change-billing' },
    ],
  },
];

/** Tenant Actions bottom sheet, grouped per Stayo App.dc.html. Every row is real — wired to the same backend flows used elsewhere in the app (Change Rent's identity-confirmed pattern, the tenant's own Activity tab, etc), none are silent no-ops. */
export function TenantActionsSheet({
  open,
  onClose,
  onCollectPayment,
  onChangeRent,
  onCheckout,
  onShareLink,
  onCreateCharge,
  onViewReceipts,
  onRequestChange,
  onChangeBilling,
  onChangeRoom,
}: TenantActionsSheetProps) {
  const ROW_HANDLERS: Record<string, () => void> = {
    collect: onCollectPayment,
    'change-rent': onChangeRent,
    checkout: onCheckout,
    'share-link': onShareLink,
    'create-charge': onCreateCharge,
    'view-receipts': onViewReceipts,
    'request-change': onRequestChange,
    'change-billing': onChangeBilling,
    'change-room': onChangeRoom,
  };

  const handleRow = (key: string) => {
    onClose();
    ROW_HANDLERS[key]?.();
  };

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title="Actions">
      <div className="flex flex-col gap-3.5">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{group.label}</span>
            {group.rows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => handleRow(row.key)}
                className={`flex items-center gap-3 rounded-2xl p-3.5 text-left ${
                  row.key === 'collect' ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-[11px] ${row.key === 'collect' ? 'bg-white/15' : 'bg-card'}`}>
                  <row.icon className={`h-4.5 w-4.5 ${row.key === 'collect' ? 'text-primary-foreground' : 'text-muted-foreground'}`} strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-bold ${row.key === 'collect' ? 'text-primary-foreground' : 'text-foreground'}`}>{row.title}</div>
                  <div className={`text-[11px] ${row.key === 'collect' ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{row.sub}</div>
                </div>
              </button>
            ))}
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Tenancy</span>
          <button
            type="button"
            onClick={() => handleRow('checkout')}
            className="flex items-center gap-3 rounded-2xl border border-destructive/25 bg-card p-3.5 text-left"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-destructive/10">
              <LogOut className="h-4.5 w-4.5 text-destructive" strokeWidth={1.9} />
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-destructive">Check-out / Exit</div>
              <div className="text-[11px] text-muted-foreground">Close tenancy & settle dues</div>
            </div>
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
