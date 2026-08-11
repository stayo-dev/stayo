import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';

interface CancelInvitationModalProps {
  open: boolean;
  onClose: () => void;
  tenantName: string;
  onConfirm: () => Promise<void>;
}

export function CancelInvitationModal({ open, onClose, tenantName, onConfirm }: CancelInvitationModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) return null;

  const handleCancel = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Error handled by parent toast
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-card rounded-2xl border border-border p-6 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" strokeWidth={2} />
            </span>
            <h3 className="font-display text-base font-extrabold text-foreground">Cancel invitation?</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <b className="font-semibold text-foreground">{tenantName}</b> will no longer be able to use this invitation link.
        </p>

        <div className="mt-3.5 rounded-xl bg-muted/60 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
          Their pending tenancy configuration will be retained for 30 days so you can re-invite them anytime.
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded-xl border border-border bg-card py-3 font-display text-xs font-bold text-foreground active:scale-[0.98]"
          >
            Keep invitation
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="flex-1 rounded-xl bg-destructive py-3 font-display text-xs font-bold text-destructive-foreground active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isSubmitting ? <StayoLoader size="sm" label={null} /> : 'Cancel invitation'}
          </button>
        </div>
      </div>
    </div>
  );
}
