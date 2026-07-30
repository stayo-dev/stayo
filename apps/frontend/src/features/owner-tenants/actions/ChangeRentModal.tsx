import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { identityService } from '@features/auth/api';
import { tenantService } from '@features/tenants/api';
import { queryKeys } from '@lib/queryKeys';

interface ChangeRentModalProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  hostelId: string;
  tenantName: string;
  currentRent: number;
}

function nextMonthValue() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7); // YYYY-MM, for <input type="month">
}

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

const labelStyle = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

/**
 * Real Change Rent flow: identity-confirmed (password re-entry, same
 * `POST /auth/confirm-identity` pattern as Quick Collect) then
 * `POST /tenants/:id/change-rent`, which reprices any not-yet-paid rent
 * obligations at or after the effective month. Requires an active agreement
 * on file — surfaces the backend's error directly if none exists.
 */
export function ChangeRentModal({ open, onClose, tenantId, hostelId, tenantName, currentRent }: ChangeRentModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'form' | 'password' | 'success'>('form');
  const [newRent, setNewRent] = useState('');
  const [effectiveMonth, setEffectiveMonth] = useState(nextMonthValue());
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (open) {
      setStep('form');
      setNewRent('');
      setEffectiveMonth(nextMonthValue());
      setReason('');
      setPassword('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const identity = await identityService.confirmIdentity(password, 'CHANGE_RENT');
      return tenantService.changeRent(tenantId, {
        hostelId,
        newRentAmount: Number(newRent),
        effectiveFromMonth: `${effectiveMonth}-01`,
        reason: reason.trim(),
        identityToken: identity.identity_token,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
      setStep('success');
    },
  });

  const isFormValid = Boolean(Number(newRent) > 0 && effectiveMonth && reason.trim());

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={step === 'success' ? 'Rent updated' : 'Change Rent'}
      footer={
        step === 'form' ? (
          <button
            type="button"
            disabled={!isFormValid}
            onClick={() => setStep('password')}
            className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            Continue
          </button>
        ) : step === 'password' ? (
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setStep('form')} className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground">
              Back
            </button>
            <button
              type="button"
              disabled={!password.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
              className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving…' : 'Confirm change'}
            </button>
          </div>
        ) : (
          <button type="button" onClick={onClose} className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground">
            Done
          </button>
        )
      }
    >
      {step === 'form' && (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-muted-foreground">
            Current rent for <b className="text-foreground">{tenantName}</b> is <b className="text-foreground">₹{currentRent.toLocaleString('en-IN')}</b>/month.
          </p>
          <label className="block">
            <span className={labelStyle}>New Monthly Rent *</span>
            <div className="mt-1.5 flex items-center rounded-xl border-[1.5px] border-primary bg-card px-3.5">
              <span className="text-base font-bold text-primary">₹</span>
              <input
                value={newRent}
                onChange={(e) => setNewRent(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="Enter new rent amount"
                className="min-w-0 flex-1 bg-transparent px-2 py-3 font-display text-base font-bold text-foreground focus:outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className={labelStyle}>Effective From *</span>
            <input
              type="month"
              value={effectiveMonth}
              onChange={(e) => setEffectiveMonth(e.target.value)}
              className="mt-1.5 w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Not-yet-paid rent obligations from this month onward will be repriced.</p>
          </label>
          <label className="block">
            <span className={labelStyle}>Reason *</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Annual rent revision, room upgrade…"
              className="mt-1.5 min-h-[64px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </label>
        </div>
      )}

      {step === 'password' && (
        <div className="flex flex-col items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary font-display text-lg font-bold text-primary">••</span>
          <p className="font-display text-base font-extrabold text-foreground">Confirm with your password</p>
          <p className="max-w-[280px] text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Changing <b className="text-foreground">{tenantName}</b>'s rent to <b className="text-foreground">₹{(Number(newRent) || 0).toLocaleString('en-IN')}</b> requires your account password.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="mt-1 w-full rounded-[14px] border-[1.5px] border-border bg-card px-4 py-3.5 text-center text-[15px] font-semibold tracking-widest text-foreground focus:border-primary focus:outline-none"
          />
          {mutation.isError && (
            <p className="text-[11.5px] font-semibold text-destructive">{getErrorMessage(mutation.error, 'Could not update the rent. Please try again.')}</p>
          )}
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <Check className="h-7 w-7 text-success" strokeWidth={3} />
          </span>
          <p className="font-display text-lg font-extrabold text-foreground">Rent updated</p>
          <p className="text-[12.5px] text-muted-foreground">
            {tenantName}'s rent is now ₹{(Number(newRent) || 0).toLocaleString('en-IN')}/month, effective {effectiveMonth}.
          </p>
        </div>
      )}
    </BottomSheet>
  );
}
