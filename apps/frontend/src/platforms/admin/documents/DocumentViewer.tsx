import { useEffect, useState } from 'react';
import { ExternalLink, FileWarning, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { previewKind, type AdminOwnerDocument } from './documentQueue';

interface DocumentViewerProps {
  document: AdminOwnerDocument;
}

const ZOOM_STEPS = [1, 1.5, 2, 3];

/**
 * Shows the document being reviewed, inline.
 *
 * Inline is the whole point: a link that opens a new tab breaks the review
 * loop on every single item, and a reviewer working a queue would spend more
 * time switching tabs than deciding.
 *
 * Zoom and rotate exist because of what actually arrives — phone photos of
 * Aadhaar cards, frequently sideways and too small to read an ID number at
 * fit-to-width.
 */
export function DocumentViewer({ document: doc }: DocumentViewerProps) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [failed, setFailed] = useState(false);

  // Reset the view whenever a different document is shown — carrying a 3x
  // zoom and a 270° rotation onto the next person's PAN card is disorienting.
  useEffect(() => {
    setZoomIndex(0);
    setRotation(0);
    setFailed(false);
  }, [doc.id]);

  const kind = previewKind(doc.mime_type);
  const zoom = ZOOM_STEPS[zoomIndex];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#F2ECE5] px-4 py-2.5">
        <span className="text-[12px] font-bold text-[#8A7F75]">
          {doc.mime_type?.split('/')[1]?.toUpperCase() ?? 'FILE'}
        </span>

        {kind === 'image' && !failed && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoomIndex === 0}
              onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E7DDD1] bg-white text-[#8A7F75] disabled:opacity-40"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[34px] text-center text-[11.5px] font-bold tabular-nums text-[#8A7F75]">
              {zoom}×
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
              onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E7DDD1] bg-white text-[#8A7F75] disabled:opacity-40"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Rotate"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg border border-[#E7DDD1] bg-white text-[#8A7F75]"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <a
          href={doc.file_url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-bold text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open original
        </a>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto bg-[#F7F3EF] p-4">
        {kind === 'image' && !failed && (
          <img
            src={doc.file_url}
            alt={`${doc.doc_type} uploaded by ${doc.profile?.name ?? 'owner'}`}
            onError={() => setFailed(true)}
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            className="max-h-full max-w-full origin-center rounded-lg object-contain shadow-[0_8px_24px_-12px_rgba(40,30,20,0.4)] transition-transform"
          />
        )}

        {kind === 'pdf' && !failed && (
          <iframe
            src={doc.file_url}
            title={`${doc.doc_type} document`}
            onError={() => setFailed(true)}
            className="h-full min-h-[420px] w-full rounded-lg border border-[#E7DDD1] bg-white"
          />
        )}

        {/* Never leave the reviewer staring at a blank box wondering whether
            it is still loading. Say what happened and give them the file. */}
        {(kind === 'unknown' || failed) && (
          <div className="max-w-[280px] text-center">
            <FileWarning className="mx-auto mb-3 h-8 w-8 text-[#9C9186]" strokeWidth={1.8} />
            <p className="text-[13px] font-bold text-foreground">
              {failed ? "This file couldn't be displayed" : 'No inline preview for this file type'}
            </p>
            <p className="mt-1 text-[12px] text-[#8A7F75]">
              Open it in a new tab to review it, then come back to decide.
            </p>
            <a
              href={doc.file_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] border border-[#E7DDD1] bg-white px-3.5 py-2 text-[12.5px] font-bold text-foreground hover:border-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open document
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
