import { useState } from 'react';
import { AlertCircle, Download, ExternalLink, Maximize2, X } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import { useDocumentBlob } from './useDocumentBlob';
import { looksLikePdf } from './documentSource';

/**
 * A document, shown inline with the owner's real session — the preview both
 * the tenant profile's sheet and the review queue render, so a document looks
 * the same wherever the owner decides about it.
 *
 * Fetched through `useDocumentBlob`, so an expired session or a missing file
 * says which it was rather than showing a blank frame.
 *
 * Mobile first: the image fills the width, and a tap opens it full-screen.
 * Checking a name or an Aadhaar number against a phone-sized thumbnail is
 * exactly how a wrong document gets approved.
 *
 * Download is a click on a blob anchor rather than an `<a download>` pointing
 * at the backend, because browsers ignore `download` cross-origin.
 */

interface DocumentPreviewPaneProps {
  /** The absolute `download_url` from the document row; null renders "nothing to preview". */
  url: string | null;
  title: string;
  /** Suggested filename for the download. */
  fileName: string;
  /** Tailwind max-height for the inline image — the queue gives it more room than a sheet. */
  imageMaxHeight?: string;
}

export function DocumentPreviewPane({ url, title, fileName, imageMaxHeight = 'max-h-[52dvh]' }: DocumentPreviewPaneProps) {
  const { objectUrl, contentType, status, error, mode } = useDocumentBlob(url);
  const [zoomed, setZoomed] = useState(false);

  const isPdf = objectUrl ? looksLikePdf(objectUrl, contentType) : false;

  /**
   * A blob can be saved with `<a download>`; a direct third-party URL cannot —
   * browsers ignore `download` cross-origin and navigate instead. Opening it
   * in a tab is the honest action there, and the button says so.
   */
  const isDirect = mode === 'direct';

  const save = () => {
    if (!objectUrl) return;
    if (isDirect) {
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-[14px] border border-border bg-muted/40">
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
                <p className="text-[12.5px] text-muted-foreground">This browser can’t show PDFs inline.</p>
                <button
                  type="button"
                  onClick={save}
                  className="min-h-11 rounded-xl bg-primary px-4 py-2 font-display text-[12.5px] font-bold text-primary-foreground"
                >
                  {isDirect ? 'Open to view' : 'Download to view'}
                </button>
              </div>
            </object>
          ) : (
            <button type="button" onClick={() => setZoomed(true)} className="block w-full" aria-label={`Enlarge ${title}`}>
              <img src={objectUrl} alt={title} className={`${imageMaxHeight} w-full object-contain`} />
              <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">
                <Maximize2 className="h-3 w-3" strokeWidth={2.2} />
                Tap to enlarge
              </span>
            </button>
          )
        )}

        {status === 'idle' && <p className="px-6 py-8 text-center text-[12.5px] text-muted-foreground">Nothing to preview.</p>}
      </div>

      {status === 'ready' && (
        <button
          type="button"
          onClick={save}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 font-display text-[12.5px] font-bold text-foreground"
        >
          {isDirect ? (
            <>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
              Open in new tab
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
              Download
            </>
          )}
        </button>
      )}

      {/* Full-screen view. Pinch-zoom works on the page itself, so the image is
          simply given the whole screen rather than wrapped in a zoom library. */}
      {zoomed && objectUrl && !isPdf && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={title}>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="truncate font-display text-[14px] font-bold text-white">{title}</span>
            <button
              type="button"
              onClick={() => setZoomed(false)}
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">
            <img src={objectUrl} alt={title} className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
