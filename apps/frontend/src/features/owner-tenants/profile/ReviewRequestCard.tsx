import { useState } from 'react';
import { Check, Eye, ShieldQuestion, X } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { documentTypeLabel } from '../documents/kycDocuments';
import type { DocumentShare } from '../api/documentShares';

/**
 * One vault document a tenant has shared with this hostel, awaiting a verdict.
 *
 * Kept visually distinct from the KYC cards below it, and never merged with
 * them, because the two carry different meanings: a verdict here is scoped to
 * this hostel's **share** of the document, while a KYC verdict is written to
 * the document itself. A tenant's Aadhaar can legitimately appear in both
 * lists, verified in one and pending in the other.
 *
 * The tenant is told the rejection reason, so it is required — the same rule
 * the KYC reject sheet enforces.
 */

interface ReviewRequestCardProps {
  share: DocumentShare;
  isBusy: boolean;
  onPreview: (share: DocumentShare) => void;
  onDecide: (verdict: 'VERIFIED' | 'REJECTED', reason?: string) => void;
}

const actionBtn =
  'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2.5 font-display text-[12.5px] font-bold disabled:opacity-50';

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ReviewRequestCard({ share, isBusy, onPreview, onDecide }: ReviewRequestCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const shared = formatDate(share.document.created_at);
  const canSubmitRejection = reason.trim().length > 0 && !isBusy;

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-primary/25 bg-secondary/25 p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-primary/10">
          <ShieldQuestion className="h-4.5 w-4.5 text-primary" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-foreground">
            {documentTypeLabel(share.document.doc_type)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {share.document.profile?.name ? `Shared by ${share.document.profile.name}` : 'Shared with you'}
            {shared ? ` · ${shared}` : ''}
          </div>
        </div>
        <StatusPill tone="warning">Needs review</StatusPill>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Your decision applies to this hostel only — it does not verify the document anywhere else.
      </p>

      <button
        type="button"
        onClick={() => onPreview(share)}
        className={`${actionBtn} border border-border bg-card text-foreground`}
      >
        <Eye className="h-3.5 w-3.5" strokeWidth={1.9} />
        View document
      </button>

      {rejecting ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`reject-${share.share_id}`} className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Why are you sending it back? <span className="text-destructive">*</span>
          </label>
          <textarea
            id={`reject-${share.share_id}`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The tenant sees this — e.g. photo is blurred, name doesn't match"
            className="w-full resize-none rounded-[11px] border border-border bg-background px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setReason('');
              }}
              disabled={isBusy}
              className={`${actionBtn} border border-border bg-card text-foreground`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onDecide('REJECTED', reason.trim())}
              disabled={!canSubmitRejection}
              className={`${actionBtn} bg-destructive text-white`}
            >
              {isBusy ? 'Sending…' : 'Send back'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDecide('VERIFIED')}
            disabled={isBusy}
            className={`${actionBtn} bg-success text-white`}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
            {isBusy ? 'Accepting…' : 'Accept'}
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            disabled={isBusy}
            className={`${actionBtn} border border-destructive/30 bg-card text-destructive`}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
            Send back
          </button>
        </div>
      )}
    </div>
  );
}
