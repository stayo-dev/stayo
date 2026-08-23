import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Share2 } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { ownerExportService, type ExportPreview } from '@features/owner-payouts/api/exports';
import {
  EXPORT_DOCUMENTS, periodOptions, previewLine, customRangeError, documentById,
  type ExportDocumentId, type PeriodPresetId,
} from './exportDocuments';

/**
 * Export — one sheet for the whole Money tab.
 *
 * It asks **who this is for**, not what format you want, because every export
 * an owner makes is handed to somebody else and he has no opinion about CSV
 * versus XLSX. Choosing the purpose also dissolves the collections-versus-
 * payouts split: he never picks a data domain, he picks what he is doing, and
 * the right rows come along.
 *
 * Replaces the old scope-and-format Export Expenses sheet, so there is one way
 * to export rather than two inconsistent ones.
 */

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  hostels: { id: string; name: string }[];
  /** The hostel currently selected on the Money tab, or null for all. */
  hostelId: string | null;
}

export function ExportSheet({ open, onClose, hostels, hostelId }: ExportSheetProps) {
  const [document_, setDocument] = useState<ExportDocumentId>('accountant');
  const [preset, setPreset] = useState<PeriodPresetId>('this_fy');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [busy, setBusy] = useState<null | 'download' | 'share'>(null);

  const periods = useMemo(() => periodOptions(), []);
  const rangeError = preset === 'custom' ? customRangeError(from, to) : null;
  const doc = documentById(document_);
  const params = { document: document_, preset, from, to, hostelId };

  // Say what is in the file before generating it, so he can tell it is the
  // right thing without opening it — and re-ask whenever the answer changes.
  useEffect(() => {
    if (!open || rangeError) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreview(null);
    ownerExportService
      .preview(params)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, document_, preset, from, to, hostelId]);

  const run = async (mode: 'download' | 'share') => {
    setBusy(mode);
    try {
      const { blob, filename } = await ownerExportService.download(params);
      const file = new File([blob], filename, { type: blob.type });

      // Sharing a real file needs the Web Share API — a wa.me link cannot carry
      // one. Where the OS sheet is unavailable we fall back to a download
      // rather than opening WhatsApp with nothing attached.
      if (mode === 'share' && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: doc.label });
        onClose();
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = filename;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      stayoToast.success(`${doc.label} saved as ${doc.formatLabel}`);
      onClose();
    } catch (error: any) {
      // The owner cares that it failed and that his data is fine, not why.
      if (error?.name !== 'AbortError') stayoToast.error("Couldn't build that file. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const line = previewLine(preview);
  const blocked = Boolean(rangeError) || busy !== null;

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title="Export">
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            What do you need it for?
          </p>
          <div className="flex flex-col gap-2">
            {EXPORT_DOCUMENTS.map((d) => {
              const active = d.id === document_;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDocument(d.id)}
                  className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                    active ? 'border-primary bg-primary/[0.06]' : 'border-border bg-card'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                      active ? 'border-primary bg-primary' : 'border-border'
                    }`}
                  >
                    {active && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3.5} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-display text-[13.5px] font-bold text-foreground">{d.label}</span>
                      <span className="flex-none text-[10.5px] font-semibold text-muted-foreground">{d.formatLabel}</span>
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{d.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Period</p>
          <div className="flex flex-wrap gap-1.5">
            {periods.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                title={p.sub}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                  preset === p.id ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset !== 'custom' && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {periods.find((p) => p.id === preset)?.sub}
            </p>
          )}
          {preset === 'custom' && (
            <div className="mt-2 flex gap-2">
              <input
                type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
              <input
                type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          )}
          {rangeError && <p className="mt-1.5 text-[11px] font-semibold text-destructive">{rangeError}</p>}
        </div>

        {/* A payout is one bank transfer covering every hostel, so the chase
            list and rent register can be narrowed but reconciliation reads
            oddly when filtered — the label says which is being applied. */}
        {hostels.length > 1 && (
          <p className="text-[11px] text-muted-foreground">
            {hostelId ? hostels.find((h) => h.id === hostelId)?.name ?? 'One hostel' : 'All hostels'} · change this on
            the Money screen
          </p>
        )}

        <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-center">
          <span className="text-[12.5px] font-semibold text-foreground">
            {rangeError ? 'Pick a valid period' : line ?? 'Checking…'}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run('download')}
            disabled={blocked}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-display text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {busy === 'download' ? 'Preparing…' : 'Download'}
          </button>
          {canShare && (
            <button
              type="button"
              onClick={() => run('share')}
              disabled={blocked}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 font-display text-[13px] font-bold text-foreground disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" />
              {busy === 'share' ? 'Preparing…' : 'Share'}
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
