import { useState } from 'react';
import { X, Ban, KeyRound } from 'lucide-react';
import { identityService } from '@features/auth/api';
import { toast } from 'sonner';
import { hmsToast } from '@lib/toast';
import { StayoLoader } from '@shared/ui/brand';

interface Obligation {
  id?: string;
  obligation_id?: string;
  rent_month?: string;
  billing_period_start?: string;
  installment_label?: string;
  type?: string;
  outstanding?: number;
  amount?: number;
}

interface WaiveObligationModalProps {
  isOpen: boolean;
  onClose: () => void;
  obligation: Obligation | null;
  onConfirm: (reason: string, identityToken: string) => Promise<void>;
}

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
const fmtMonth = (value?: string) => {
  if (!value) return 'Unknown';
  if (!Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  return value;
};

export function WaiveObligationModal({
  isOpen,
  onClose,
  obligation,
  onConfirm,
}: WaiveObligationModalProps) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !obligation) return null;

  const handleWaive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('Please enter a reason for waiving this charge');
      return;
    }
    if (!password.trim()) {
      toast.error('Enter your password to authorize this action');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Confirm identity and fetch verification token
      const identity = await identityService.confirmIdentity(password, 'WAIVE_OBLIGATION');
      const identityToken = identity?.identity_token ?? identity?.data?.identity_token;
      if (!identityToken) {
        throw new Error('Identity verification failed. Invalid password.');
      }

      // 2. Execute waiver API
      await onConfirm(reason.trim(), identityToken);
      toast.success('Dues waived successfully');
      setReason('');
      setPassword('');
      onClose();
    } catch (err: any) {
      hmsToast.error(err, 'Waive Dues');
    } finally {
      setIsSubmitting(false);
    }
  };

  const amount = Number(obligation.outstanding ?? obligation.amount ?? 0);
  const label = obligation.installment_label ?? fmtMonth(obligation.billing_period_start ?? obligation.rent_month);
  const typeLabel = obligation.type ? String(obligation.type).replaceAll('_', ' ') : 'Rent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
          <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600">
            <Ban className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Waive Financial Dues</h3>
            <p className="text-xs text-muted-foreground">This writes off the selected obligation</p>
          </div>
        </div>

        <div className="bg-muted/50 rounded-2xl p-4 border border-border/40 space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Obligation:</span>
            <span className="font-semibold text-foreground">{typeLabel} ({label})</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Outstanding Amount:</span>
            <span className="font-semibold text-rose-600">{fmt(amount)}</span>
          </div>
        </div>

        <form onSubmit={handleWaive} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Reason for Waiver <span className="text-rose-500">*</span>
            </label>
            <textarea
              required
              rows={2}
              disabled={isSubmitting}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Approved COVID relief discount or manager discount"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
              Confirm Password <span className="text-rose-500">*</span>
            </label>
            <input
              required
              type="password"
              disabled={isSubmitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your login password"
              className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="bg-rose-500/5 text-rose-600 dark:text-rose-400 rounded-xl p-3 border border-rose-500/10 text-xs leading-relaxed">
            <strong>Warning:</strong> Waiving will write a ledger correction record adjusting this obligation. This action cannot be reversed.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold hover:bg-accent hover:text-accent-foreground active:scale-98 transition-transform disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold active:scale-98 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <StayoLoader size="sm" label={null} />
              ) : (
                <Ban className="w-4 h-4" />
              )}
              <span>Confirm Waiver</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
