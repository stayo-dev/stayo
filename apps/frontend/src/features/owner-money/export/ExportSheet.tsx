import { useEffect, useMemo, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { AdaptiveSurface } from '@/app/components/ui/adaptive-surface';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { downloadBlob, shareOrDownload, canShareFiles } from '@shared/lib/downloadBlob';
import { ownerExportService, type ExportPreview } from '@features/owner-payouts/api/exports';
import { exportById, periodOptions, previewLine, divergenceNote } from './exportDocuments';
import type { ExportQuery, MoneyExportId, PeriodPresetId } from './exportRequest';

/**
 * Export — one small sheet, shared by all three exports.
 *
 * It does not ask what the file is for. Each export is reached from the Money
 * sub-tab that shows its data, so where the owner tapped already answered that
 * (ADR-197). It does not ask for a format either: everything is a spreadsheet.
 *
 * What is left is at most one question — the period, and only on the two
 * screens that do not already imply one — a line saying what is in the file,
 * and the two things he can do with it.
 */

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  /** Which export. Decided by where he tapped, never asked. */
  target: MoneyExportId;
  /** The finished query, or the reason there isn't one. */
  query: ExportQuery;
  /** "All hostels", "Sunrise Residency", "Business (HQ)" — plus any filters. */
  scopeLine: string;
  /**
   * How many rows the screen behind is showing, when that is knowable.
   *
   * The list is paginated and the export is not, so the counts can legitimately
   * differ. Saying so is the difference between an owner trusting the file and
   * wondering which number is wrong.
   */
  onScreenCount?: number | null;
  /** Period controls. Absent where the screen already implies a period. */
  period?: {
    preset: PeriodPresetId;
    onPresetChange: (p: PeriodPresetId) => void;
    from: string;
    to: string;
    onFromChange: (v: string) => void;
    onToChange: (v: string) => void;
  };
}

export function ExportSheet({ open, onClose, target, query, scopeLine, period, onScreenCount = null }: ExportSheetProps) {
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [busy, setBusy] = useState<null | 'download' | 'share'>(null);
  const doc = exportById(target);
  const periods = useMemo(() => periodOptions(), []);

  const key = query.query ? new URLSearchParams(query.query).toString() : null;

  /**
   * Say what is in the file before generating it, so he can tell it is the
   * right thing without opening it.
   *
   * Debounced, because on the Expenses tab this re-fires on every keystroke in
   * the search box, and aborted on change so a slow earlier answer cannot land
   * after a newer one and describe the wrong file.
   */
  useEffect(() => {
    if (!open || !key) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    setPreview(null);
    const timer = setTimeout(() => {
      ownerExportService
        .preview(Object.fromEntries(new URLSearchParams(key)), controller.signal)
        .then((p) => setPreview(p))
        .catch(() => undefined);
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, key]);

  const run = async (mode: 'download' | 'share') => {
    if (!query.query) return;
    setBusy(mode);
    try {
      const { blob, filename } = await ownerExportService.download(query.query);
      // Statically imported on purpose: a dynamic `await import()` inside this
      // handler is what Vite mis-transformed in production last time, and the
      // export button threw "Cannot read properties of undefined".
      if (mode === 'share') {
        const how = await shareOrDownload(blob, filename, doc.heading);
        if (how === 'downloaded') stayoToast.success(`${doc.heading} saved`);
      } else {
        downloadBlob(blob, filename);
        stayoToast.success(`${doc.heading} saved`);
      }
      onClose();
    } catch (error: any) {
      // The owner cares that it failed and that his data is fine, not why.
      if (error?.name !== 'AbortError') stayoToast.error("Couldn't build that file. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const line = previewLine(preview);
  const divergence = preview ? divergenceNote(preview.count, onScreenCount) : null;
  const blocked = !query.query || busy !== null;

  return (
    <AdaptiveSurface
      variant="form"
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={doc.heading}
      /**
       * The actions live in the sheet's own footer rather than at the end of the
       * body. On a small phone the body scrolls, and buttons at the bottom of it
       * scrolled out of reach.
       */
      footer={
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
          {canShareFiles() && (
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
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-[12.5px] leading-snug text-muted-foreground">{doc.sub}</p>

        {period && (
          <div>
            <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Period</p>
            <div className="flex flex-wrap gap-1.5">
              {periods.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => period.onPresetChange(p.id)}
                  title={p.sub}
                  className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    period.preset === p.id
                      ? 'bg-foreground text-background'
                      : 'border border-border bg-card text-muted-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {period.preset !== 'custom' && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {periods.find((p) => p.id === period.preset)?.sub}
              </p>
            )}
            {period.preset === 'custom' && (
              <div className="mt-2 flex gap-2">
                <input
                  type="date"
                  value={period.from}
                  onChange={(e) => period.onFromChange(e.target.value)}
                  aria-label="Start date"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                />
                <input
                  type="date"
                  value={period.to}
                  onChange={(e) => period.onToChange(e.target.value)}
                  aria-label="End date"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
            )}
          </div>
        )}

        {/* What this file is narrowed to — set on the screen behind, never here,
            so the sheet stays one question at most. */}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{scopeLine}</p>

        <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-center">
          <span className="block text-[12.5px] font-semibold text-foreground">
            {query.error ?? line ?? 'Checking…'}
          </span>
          {divergence && (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{divergence}</span>
          )}
        </div>
      </div>
    </AdaptiveSurface>
  );
}
