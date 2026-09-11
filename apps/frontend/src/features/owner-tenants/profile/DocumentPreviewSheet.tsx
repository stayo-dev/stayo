import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { DocumentPreviewPane } from './DocumentPreviewPane';

/**
 * Look at a document without leaving the app.
 *
 * Previously "View" was `window.open(download_url)` — a new tab, no auth
 * header, and a blank page when it failed. The bytes are fetched with the
 * owner's real session and rendered inline by `DocumentPreviewPane`, which the
 * document review queue uses too, so a document looks the same wherever the
 * owner decides about it.
 */

interface DocumentPreviewSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The absolute `download_url` from the document row. */
  url: string | null;
  /** Suggested filename for the download. */
  fileName: string;
  /** Rendered under the preview — the approve/reject bar, the review thread, agreement terms, and so on. */
  children?: React.ReactNode;
}

export function DocumentPreviewSheet({ open, onClose, title, url, fileName, children }: DocumentPreviewSheetProps) {
  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      <div className="flex flex-col gap-3">
        <DocumentPreviewPane url={open ? url : null} title={title} fileName={fileName} />
        {children}
      </div>
    </BottomSheet>
  );
}
