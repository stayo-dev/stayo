import { useEffect, useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { MAX_REJECT_REASON_LENGTH, documentTypeLabel, isRejectReasonValid } from './kycDocuments';

interface RejectDocumentSheetProps {
  open: boolean;
  docType: string;
  tenantName: string;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** Common reasons, offered as one tap so the reason is specific rather than "no". */
const QUICK_REASONS = [
  'Photo is blurry or unreadable',
  'Document is expired',
  'Name does not match the tenant',
  'Wrong document type uploaded',
  'Only part of the document is visible',
];

/**
 * Rejecting requires a reason — the route answers 400 without one, and more to
 * the point the reason is the only thing the tenant is shown, so "rejected"
 * with no explanation leaves them unable to fix it.
 */
export function RejectDocumentSheet({
  open,
  docType,
  tenantName,
  isSubmitting,
  onClose,
  onConfirm,
}: RejectDocumentSheetProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const valid = isRejectReasonValid(reason);
  const tooLong = reason.trim().length > MAX_REJECT_REASON_LENGTH;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Reject document"
      footer={
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!valid || isSubmitting}
            className="flex-1 rounded-xl bg-destructive py-3.5 text-center font-display text-sm font-bold text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Rejecting…' : 'Reject document'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {tenantName} will see this reason on their Documents screen and can upload a replacement. Be specific
          enough that they can fix it without asking.
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {documentTypeLabel(docType)} — why?
          </span>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold ${
                  reason === r ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reason <span className="text-destructive">*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Tell them exactly what to fix…"
            className="w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
          />
          <span className={`mt-1 block text-[11px] ${tooLong ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
            {tooLong
              ? `Too long — ${reason.trim().length} of ${MAX_REJECT_REASON_LENGTH} characters allowed.`
              : `${reason.trim().length}/${MAX_REJECT_REASON_LENGTH}`}
          </span>
        </label>
      </div>
    </BottomSheet>
  );
}
