import { Check, Eye, X } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { canActOnDocument, documentTypeLabel, type ReviewDocument } from './kycDocuments';

interface DocumentReviewCardProps {
  doc: ReviewDocument;
  isBusy: boolean;
  onApprove: (documentId: string) => void;
  onReject: (doc: ReviewDocument) => void;
  /** Opens the in-app preview. Replaces the old new-tab open, which carried no auth. */
  onPreview: (doc: ReviewDocument) => void;
}

const STATUS_TONE = {
  VERIFIED: 'success',
  REJECTED: 'destructive',
  PENDING: 'warning',
  MISSING: 'neutral',
} as const;

const STATUS_LABEL = {
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  PENDING: 'Pending',
  MISSING: 'Not uploaded',
} as const;

const actionBtn =
  'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2.5 font-display text-[12.5px] font-bold disabled:opacity-50';

function formatDate(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * One KYC document, with everything the owner needs to judge it: look at it,
 * keep a copy, approve it, or send it back with a reason.
 *
 * The Documents tab previously rendered a status pill and nothing else — the
 * owner could see that a document was pending and had no way to act on it,
 * which is where tenant onboarding stopped.
 */
export function DocumentReviewCard({ doc, isBusy, onApprove, onReject, onPreview }: DocumentReviewCardProps) {
  const actionable = canActOnDocument(doc);
  const uploaded = formatDate(doc.uploadedAt);

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-foreground">{documentTypeLabel(doc.docType)}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {doc.status === 'MISSING' ? 'Not uploaded yet' : uploaded ? `Uploaded ${uploaded}` : 'Uploaded'}
          </div>
        </div>
        <StatusPill tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</StatusPill>
      </div>

      {doc.latestRejectionReason && (
        <p className="rounded-[10px] border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11.5px] leading-relaxed text-destructive">
          You rejected this: “{doc.latestRejectionReason}”
        </p>
      )}

      {doc.downloadUrl && (
        <button
          type="button"
          onClick={() => onPreview(doc)}
          className={`${actionBtn} border border-border bg-card text-foreground`}
        >
          <Eye className="h-3.5 w-3.5" strokeWidth={1.9} />
          View &amp; download
        </button>
      )}

      {actionable && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onApprove(doc.id)}
            disabled={isBusy}
            className={`${actionBtn} bg-success text-white`}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
            {isBusy ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => onReject(doc)}
            disabled={isBusy}
            className={`${actionBtn} border border-destructive/30 bg-card text-destructive`}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
