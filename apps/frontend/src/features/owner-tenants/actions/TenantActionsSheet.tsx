import {
  Receipt,
  FileStack,
  RotateCcw,
  ArrowLeftRight,
  CalendarClock,
  BedDouble,
  LogOut,
} from 'lucide-react';
import { AdaptiveSurface } from '@/app/components/ui/adaptive-surface';

interface TenantActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onChangeRent: () => void;
  onCheckout: () => void;
  onCreateCharge: () => void;
  onViewReceipts: () => void;
  onRequestChange: () => void;
  onChangeBilling: () => void;
  onChangeRoom: () => void;
}

const GROUPS: {
  label: string;
  rows: { icon: typeof Receipt; title: string; sub: string; key: string }[];
}[] = [
  {
    label: 'Charges & Receipts',
    rows: [
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
      { icon: RotateCcw, title: 'Amend Agreement', sub: 'Duration, deposit, maintenance', key: 'request-change' },
      { icon: ArrowLeftRight, title: 'Change Rent', sub: 'Revise monthly rent amount', key: 'change-rent' },
      { icon: CalendarClock, title: 'Change Billing Frequency', sub: 'Monthly, quarterly or yearly', key: 'change-billing' },
    ],
  },
];

/** Tenant Actions menu, grouped per Stayo App.dc.html (Receive Payment and Share Payment Link removed by product decision 2026-10-10; collecting stays on the profile's "Collect Now" card) — a `BottomSheet` below `lg`, a right-side drawer at `lg+` (`AdaptiveSurface variant="form"`, ADR-171 Phase 2.4) so the grouped rich rows keep their layout and the profile stays visible behind it. Every row is real — wired to the same backend flows used elsewhere in the app (Change Rent's identity-confirmed pattern, the tenant's own Activity tab, etc), none are silent no-ops. */
export function TenantActionsSheet({
  open,
  onClose,
  onChangeRent,
  onCheckout,
  onCreateCharge,
  onViewReceipts,
  onRequestChange,
  onChangeBilling,
  onChangeRoom,
}: TenantActionsSheetProps) {
  const ROW_HANDLERS: Record<string, () => void> = {
    'change-rent': onChangeRent,
    checkout: onCheckout,
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
    <AdaptiveSurface variant="form" open={open} onOpenChange={(v) => !v && onClose()} title="Actions">
      <div className="flex flex-col gap-3.5">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            <span className="px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{group.label}</span>
            {group.rows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => handleRow(row.key)}
                className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-left"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card">
                  <row.icon className="h-4.5 w-4.5 text-muted-foreground" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-bold text-foreground">{row.title}</div>
                  <div className="text-[11px] text-muted-foreground">{row.sub}</div>
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
    </AdaptiveSurface>
  );
}
