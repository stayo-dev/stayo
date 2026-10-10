import { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { AdaptiveSurface } from '@/app/components/ui/adaptive-surface';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { paymentService } from '@features/payments/api';
import type { TenantReceipt } from '../hooks/useTenantDetail';

interface ReceiptsSheetProps {
  open: boolean;
  onClose: () => void;
  tenantName: string;
  receipts: TenantReceipt[];
}

/**
 * "View Receipts" from the tenant Actions menu. It used to just switch the
 * profile to its Activity tab — usually below the fold, so the tap looked
 * like it did nothing, and that tab lists events, not receipts. Each row here
 * is a recorded payment; tapping it downloads the same receipt PDF the tenant
 * gets (`GET /payments/:id/receipt`).
 */
export function ReceiptsSheet({ open, onClose, tenantName, receipts }: ReceiptsSheetProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const download = async (receipt: TenantReceipt) => {
    setDownloadingId(receipt.id);
    try {
      const blob: Blob = await paymentService.downloadReceipt(receipt.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${tenantName.replace(/\s+/g, '-').toLowerCase()}-${receipt.id.slice(0, 8)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 250);
    } catch (e: any) {
      stayoToast.error(e?.response?.data?.detail || e?.message || "Couldn't download that receipt");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <AdaptiveSurface variant="form" open={open} onOpenChange={(v) => !v && onClose()} title="Receipts" description={tenantName}>
      {receipts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-muted px-4 py-8 text-center">
          <FileText className="h-6 w-6 text-muted-foreground" strokeWidth={1.8} />
          <div className="text-[13.5px] font-bold text-foreground">No receipts yet</div>
          <div className="text-[11.5px] text-muted-foreground">A receipt is issued each time a payment is recorded.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {receipts.map((r) => {
            const busy = downloadingId === r.id;
            return (
              <button
                key={r.id}
                type="button"
                disabled={downloadingId !== null}
                onClick={() => download(r)}
                className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-left disabled:opacity-70"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card">
                  <FileText className="h-4.5 w-4.5 text-muted-foreground" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[13.5px] font-bold tabular-nums text-foreground">₹{r.amount.toLocaleString('en-IN')}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {[r.date, r.method, r.reference].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {busy ? (
                  <Loader2 className="h-4 w-4 flex-none animate-spin text-muted-foreground" />
                ) : (
                  <Download className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.9} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </AdaptiveSurface>
  );
}
