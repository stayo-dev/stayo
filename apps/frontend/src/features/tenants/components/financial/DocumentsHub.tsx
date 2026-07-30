import { useState } from 'react';
import { Download, FileText, FileStack, Link2, History as HistoryIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/components/ui/tabs';
import { paymentService } from '@features/payments/api';
import { hmsToast } from '@lib/toast';
import { ChangeStatusBadge } from '@/features/change-management';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

interface RecentPayment {
  id: string;
  amount?: number;
  date?: string;
  method?: string;
  reference_number?: string;
}

interface ChangeRequestSummary {
  id: string;
  change_type?: string;
  status?: string;
  requested_at?: string;
  applied_at?: string;
}

interface DocumentsHubProps {
  tenantId: string;
  hasAgreement: boolean;
  agreementUrl?: string | null;
  recentPayments: RecentPayment[];
  recentChanges: ChangeRequestSummary[];
  onViewAllChanges?: () => void;
}

export function DocumentsHub({ tenantId, hasAgreement, agreementUrl, recentPayments, recentChanges, onViewAllChanges }: DocumentsHubProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);

  const handleDownloadReceipt = async (paymentId: string) => {
    setDownloadingId(paymentId);
    try {
      const blob = await paymentService.downloadReceipt(paymentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${paymentId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 250);
    } catch (e: any) {
      hmsToast.error(e, 'Download receipt');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleGenerateLink = async () => {
    setGeneratingLink(true);
    try {
      const res = await paymentService.generatePayLink({ tenantId });
      await navigator.clipboard?.writeText(res.url).catch(() => {});
      toast.success('Payment link copied to clipboard');
    } catch (e: any) {
      hmsToast.error(e, 'Generate payment link');
    } finally {
      setGeneratingLink(false);
    }
  };

  return (
    <div id="fin-documents" className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4 scroll-mt-20">
      <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
        <FileStack className="w-4.5 h-4.5 text-accent" />
        Documents
      </h3>

      <Tabs defaultValue="agreement">
        <TabsList className="overflow-x-auto scrollbar-hide">
          <TabsTrigger value="agreement">Agreement</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="links">Payment Links</TabsTrigger>
          <TabsTrigger value="changes">Change Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="agreement" className="pt-3">
          {hasAgreement ? (
            agreementUrl ? (
              <a
                href={agreementUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 p-3 rounded-xl border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors text-xs font-semibold text-foreground"
              >
                <FileText className="w-4 h-4 text-accent" />
                View Agreement Document
              </a>
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">Active agreement — document not yet uploaded.</p>
            )
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">No active agreement for this tenant.</p>
          )}
        </TabsContent>

        <TabsContent value="receipts" className="pt-3">
          {recentPayments.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No payments recorded yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
              {recentPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border/60 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{fmt(p.amount ?? 0)} · {p.method ?? '—'}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {p.date ? new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      {p.reference_number ? ` · Ref: ${p.reference_number}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownloadReceipt(p.id)}
                    disabled={downloadingId === p.id}
                    className="shrink-0 p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground disabled:opacity-50"
                  >
                    {downloadingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="links" className="pt-3 space-y-3">
          <p className="text-xs text-muted-foreground">Generate a payment link the tenant can use to pay any amount — current dues, upcoming rent, or in advance.</p>
          <button
            type="button"
            onClick={handleGenerateLink}
            disabled={generatingLink}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-accent-foreground text-xs font-bold hover:bg-accent/90 active:scale-95 transition-transform disabled:opacity-50"
          >
            {generatingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            <span>Generate Payment Link</span>
          </button>
        </TabsContent>

        <TabsContent value="changes" className="pt-3">
          {recentChanges.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No change requests yet.</p>
          ) : (
            <div className="space-y-1.5">
              {recentChanges.slice(0, 5).map((cr) => (
                <div key={cr.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border/60 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{String(cr.change_type ?? 'Change').replaceAll('_', ' ')}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {cr.applied_at || cr.requested_at
                        ? new Date(cr.applied_at ?? cr.requested_at ?? '').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </p>
                  </div>
                  <ChangeStatusBadge status={cr.status ?? 'PENDING'} />
                </div>
              ))}
              {onViewAllChanges && (
                <button type="button" onClick={onViewAllChanges} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline pt-1">
                  <HistoryIcon className="w-3.5 h-3.5" />
                  View all change requests
                </button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
