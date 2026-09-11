import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, IndianRupee, KeyRound } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { queryKeys } from '@lib/queryKeys';
import { identityService } from '@features/auth/api';
import { obligationService } from '../api/obligations';
import type { PaymentScheduleItem } from './paymentSchedule';

/**
 * Correcting or withdrawing a charge the owner raised by hand.
 *
 * An obligation is never edited in place and never deleted — it is the record
 * of what was owed, and rewriting it would leave the tenant's history saying
 * something that never happened. So:
 *
 *   **Correct** = raise the replacement, then withdraw the original.
 *   **Withdraw** = mark the original CANCELLED, with a reason.
 *
 * Either way the old row stays on both sides' timelines, struck through and
 * carrying the owner's reason. That is the whole point: the tenant can see
 * exactly what changed and why, rather than a charge quietly vanishing.
 *
 * The reason is mandatory and the password is asked once — cancelling is a
 * step-up action server-side (`CANCEL_OBLIGATION`), while raising a charge is
 * not, so a correction needs exactly one identity token.
 */

interface ManageChargeSheetProps {
  open: boolean;
  mode: 'edit' | 'remove';
  charge: PaymentScheduleItem | null;
  tenantId: string;
  hostelId: string;
  onClose: () => void;
}

const field =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';

export function ManageChargeSheet({ open, mode, charge, tenantId, hostelId, onClose }: ManageChargeSheetProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && charge) {
      setAmount(String(charge.amount));
      setReason('');
      setPassword('');
      setError(null);
    }
  }, [open, charge]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!charge) throw new Error('No charge selected.');
      const identity = await identityService.confirmIdentity(password, 'CANCEL_OBLIGATION');

      // Order matters: raise the replacement first. If the cancel then fails,
      // the tenant owes twice and the owner can see and fix it — the reverse
      // would silently drop the charge entirely.
      if (mode === 'edit') {
        await obligationService.create({
          tenant_id: tenantId,
          obligation_type: charge.type,
          amount: Number(amount),
          due_date: charge.dueDate ?? new Date().toISOString().slice(0, 10),
          rent_month: charge.dueDate ?? new Date().toISOString().slice(0, 10),
          description: charge.label,
        });
      }

      return obligationService.cancel(charge.id, {
        reason: mode === 'edit' ? `Corrected: ${reason.trim()}` : reason.trim(),
        identityToken: identity.identity_token,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all(hostelId) });
      stayoToast.success(mode === 'edit' ? 'Charge corrected' : 'Charge withdrawn');
      onClose();
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string } } } }) => {
      setError(e?.response?.data?.error?.message ?? e?.message ?? 'Could not update this charge.');
    },
  });

  if (!open || !charge) return null;

  const amountChanged = Number(amount) > 0 && Number(amount) !== charge.amount;
  const canSubmit = reason.trim().length > 2 && password.length > 0 && (mode === 'remove' || amountChanged);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-card p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-[17px] font-extrabold text-foreground">
          {mode === 'edit' ? 'Correct this charge' : 'Withdraw this charge'}
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {mode === 'edit'
            ? 'The original is withdrawn and replaced. Your tenant sees both, so the correction is on the record.'
            : 'The charge stops being owed. It stays on your tenant’s timeline marked withdrawn, with your reason.'}
        </p>

        <div className="mt-3.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
          <div className="font-display text-[13.5px] font-bold text-foreground">{charge.label}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            ₹{charge.amount.toLocaleString('en-IN')}
            {charge.billingPeriodLabel ? ` · ${charge.billingPeriodLabel}` : ''}
          </div>
        </div>

        {mode === 'edit' && (
          <label className="mt-3.5 block">
            <span className="text-[12px] font-semibold text-muted-foreground">Corrected amount</span>
            <div className="relative mt-1.5">
              <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${field} pl-9`}
                autoFocus
              />
            </div>
          </label>
        )}

        <label className="mt-3.5 block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Reason <span className="text-destructive">*</span>
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === 'edit' ? 'e.g. Wrong amount entered' : 'e.g. Added to the wrong tenant'}
            className={`${field} mt-1.5`}
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">Your tenant sees this.</span>
        </label>

        <label className="mt-3.5 block">
          <span className="flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" />
            Confirm your password <span className="text-destructive">*</span>
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${field} mt-1.5`}
            autoComplete="current-password"
          />
        </label>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" />
            <p className="text-[12px] font-semibold leading-relaxed text-destructive">{error}</p>
          </div>
        )}

        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-secondary py-3 text-sm font-semibold text-secondary-foreground">
            Keep it
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {mutation.isPending && <StayoLoader size="sm" label={null} />}
            {mode === 'edit' ? 'Correct charge' : 'Withdraw charge'}
          </button>
        </div>
      </div>
    </div>
  );
}
