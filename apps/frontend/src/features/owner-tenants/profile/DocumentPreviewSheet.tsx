import { AlertCircle, Download } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { StayoLoader } from '@shared/ui/brand';
import { useDocumentBlob } from './useDocumentBlob';

/**
 * Look at a document without leaving the app.
 *
 * Previously "View" was `window.open(download_url)` — a new tab, no auth
 * header, and a blank page when it failed. Here the bytes are fetched with the
 * owner's real session, rendered inline, and every failure mode says which one
 * it was.
 *
 * Download is a click on a blob anchor rather than an `<a download>` pointing
 * at the backend, because browsers ignore `download` cross-origin.
 */

interface DocumentPreviewSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The absolute `download_url` from the document row. */
  url: string | null;
  /** Suggested filename for the download. */
  fileName: string;
  /** Rendered under the preview — the review thread, agreement terms, and so on. */
  children?: React.ReactNode;
}

export function DocumentPreviewSheet({
  open,
  onClose,
  title,
  url,
  fileName,
  children,
}: DocumentPreviewSheetProps) {
  const { objectUrl, contentType, status, error } = useDocumentBlob(open ? url : null);

  const isPdf = (contentType ?? '').includes('pdf');

  const download = () => {
    if (!objectUrl) return;
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      <div className="flex flex-col gap-3">
        <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-[14px] border border-border bg-muted/40">
          {status === 'loading' && <StayoLoader size="md" className="text-primary" />}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" strokeWidth={1.8} />
              <p className="text-[12.5px] font-semibold leading-relaxed text-foreground">{error}</p>
            </div>
          )}

          {status === 'ready' && objectUrl && (
            isPdf ? (
              <object data={objectUrl} type="application/pdf" className="h-[52dvh] w-full">
                {/* Some mobile browsers refuse to embed PDFs at all — say so
                    rather than showing an empty frame. */}
                <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                  <p className="text-[12.5px] text-muted-foreground">
                    This browser can’t show PDFs inline.
                  </p>
                  <button
                    type="button"
                    onClick={download}
                    className="rounded-xl bg-primary px-4 py-2 font-display text-[12.5px] font-bold text-primary-foreground"
                  >
                    Download to view
                  </button>
                </div>
              </object>
            ) : (
              <img src={objectUrl} alt={title} className="max-h-[52dvh] w-full object-contain" />
            )
          )}

          {status === 'idle' && (
            <p className="px-6 py-8 text-center text-[12.5px] text-muted-foreground">
              Nothing to preview.
            </p>
          )}
        </div>

        {status === 'ready' && (
          <button
            type="button"
            onClick={download}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 font-display text-[12.5px] font-bold text-foreground"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
            Download
          </button>
        )}

        {children}
      </div>
    </BottomSheet>
  );
}
