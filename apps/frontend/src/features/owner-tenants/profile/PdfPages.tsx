import { useEffect, useRef, useState } from 'react';
import { StayoLoader } from '@shared/ui/brand';
import { pdfPageScale } from './pdfScale';

interface PdfPagesProps {
  /** An object URL (or same-origin URL) for the PDF bytes. */
  src: string;
  title: string;
  /** Shown instead of the pages if pdf.js cannot open the file. */
  fallback: React.ReactNode;
}

/**
 * Draws every page of a PDF to a canvas with pdf.js.
 *
 * `<object type="application/pdf">` shows nothing on most phones — Chrome on
 * Android never embeds PDFs — so a signed agreement read "This browser can't
 * show PDFs inline" and the tenant had to download it to read it. Canvas
 * rendering works in every browser.
 *
 * pdf.js is imported on demand, so it costs nothing until a PDF is opened.
 * The legacy build is used for older Android WebViews.
 */
export function PdfPages({ src, title, fallback }: PdfPagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let destroy: (() => void) | null = null;
    setStatus('loading');
    setPageCount(0);
    container.replaceChildren();

    (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        const task = pdfjs.getDocument({ url: src });
        destroy = () => void task.destroy();
        const pdf = await task.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        // The column has p-2 (8px each side); pages fill what's inside it.
        const width = Math.max(container.clientWidth - 16, 0);
        for (let n = 1; n <= pdf.numPages; n += 1) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const { cssScale, pixelScale } = pdfPageScale(width, base.width, window.devicePixelRatio);
          const viewport = page.getViewport({ scale: pixelScale });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
          canvas.style.height = `${Math.floor(base.height * cssScale)}px`;
          canvas.className = 'block rounded-md bg-white shadow-sm';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${title}, page ${n} of ${pdf.numPages}`);
          container.appendChild(canvas);

          await page.render({ canvas, viewport }).promise;
          // First page drawn: show it while the rest render below it.
          if (n === 1 && !cancelled) setStatus('ready');
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[PdfPages] could not render PDF', error);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [src, title]);

  return (
    <div className="relative h-[52dvh] w-full overflow-y-auto overscroll-contain">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <StayoLoader size="md" className="text-primary" />
        </div>
      )}
      {status === 'error' && <div className="flex h-full items-center justify-center">{fallback}</div>}
      <div ref={containerRef} className={`flex flex-col items-center gap-2 p-2 ${status === 'error' ? 'hidden' : ''}`} />
      {status === 'ready' && pageCount > 1 && (
        <p className="pb-2 text-center text-[11px] text-muted-foreground">{pageCount} pages · scroll to read</p>
      )}
    </div>
  );
}
