import { useState } from 'react';
import { X, TrendingUp, CheckCircle2 } from 'lucide-react';
import { ErrorCard } from '@/shared/ui/error/ErrorCard';
import { getHmsError } from '@lib/errors';
import { identityService } from '@features/auth/api';
import { tenantService } from '@features/tenants/api';
import { StayoLoader } from '@shared/ui/brand';

interface UpcomingObligation {
  id: string;
  rent_month: string; // ISO date
  amount: number;
}

interface ChangeRentModalProps {
  tenantId: string;
  hostelId: string;
  currentRent: number;
  upcomingObligations: UpcomingObligation[]; // tenant page's already-loaded, zero-payment upcoming/pending RENT obligations
  onClose: () => void;
  onSuccess: () => void;
}

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// First day of next calendar month (UTC), as an ISO date string. Used as the
// effectiveFromMonth default when there are no upcoming obligations to derive
// it from — the backend (applyRentChangeInTx) still requires a real month and
// will happily update agreement.contract_rent/tenants.monthly_rent even with
// zero obligations in scope, so this keeps the modal submittable rather than
// leaving effectiveFromMonth stuck at ''.
function nextMonthStartIso(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

/**
 * "Change Rent" flow: owner picks a new rent amount, the month it should
 * take effect from, and a reason → identity confirmation (password re-entry,
 * matching the pattern established by WaiveObligationModal.tsx) → submit.
 * Applies immediately, no tenant approval, and reprices any not-yet-paid
 * rent obligations at or after the chosen month (see Task 3/4's
 * rent-change-service.ts / change-rent API route — this modal is purely the
 * owner-facing entry point to that already-built backend).
 */
export function ChangeRentModal({ tenantId, hostelId, currentRent, upcomingObligations, onClose, onSuccess }: ChangeRentModalProps) {
  const [newRentAmount, setNewRentAmount] = useState(String(currentRent));
  const [effectiveFromMonth, setEffectiveFromMonth] = useState(upcomingObligations[0]?.rent_month ?? nextMonthStartIso());
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'FORM' | 'CONFIRM'>('FORM');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  // Real server-reported outcome (obligationsUpdated from RentChangeResult),
  // captured after a successful submit. The backend's safety guard is
  // stricter than this modal's client-side affectedCount preview (e.g. an
  // obligation that has had a payment reversed nets to paid === 0 but still
  // has payment records, so the backend correctly skips it while the
  // pre-submit preview still counted it) — showing the real count here makes
  // any such discrepancy visible instead of silently trusting the preview.
  const [obligationsUpdated, setObligationsUpdated] = useState<number | null>(null);

  const affectedCount = upcomingObligations.filter(
    (o) => new Date(o.rent_month).getTime() >= new Date(effectiveFromMonth).getTime()
  ).length;

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (!(Number(newRentAmount) > 0)) {
      setFieldError('Enter a valid new rent amount.');
      return;
    }
    if (!effectiveFromMonth) {
      setFieldError('Choose the month the new rent should start from.');
      return;
    }
    if (!reason.trim()) {
      setFieldError('Enter a reason for this change.');
      return;
    }
    setStep('CONFIRM');
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setApiError(null);
    setIsSubmitting(true);
    try {
      // Step 1: identity confirmation, mirroring WaiveObligationModal.tsx.
      // identityService.confirmIdentity returns response.data directly
      // (an unwrapped { identity_token, expires_in, purpose } object), but
      // the fallback keeps this resilient if that ever changes shape.
      const identity = await identityService.confirmIdentity(password, 'CHANGE_RENT');
      const identityToken = identity?.identity_token ?? identity?.data?.identity_token;
      if (!identityToken) throw new Error('Identity verification failed. Invalid password.');

      // Step 2: execute the rent change.
      const result = await tenantService.changeRent(tenantId, {
        hostelId,
        newRentAmount: Number(newRentAmount),
        effectiveFromMonth,
        reason: reason.trim(),
        identityToken,
      });
      setObligationsUpdated(typeof result?.obligationsUpdated === 'number' ? result.obligationsUpdated : null);
      setSucceeded(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1200);
    } catch (err) {
      setApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button type="button" onClick={onClose} disabled={isSubmitting} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50">
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
          <div className="p-2 rounded-xl bg-accent/10 text-accent">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Change Rent</h3>
            <p className="text-xs text-muted-foreground">Applies immediately — no tenant approval required</p>
          </div>
        </div>

        {succeeded ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-foreground">Rent updated</p>
            <p className="text-xs text-muted-foreground">
              {obligationsUpdated !== null
                ? `${obligationsUpdated} installment${obligationsUpdated === 1 ? '' : 's'} updated.`
                : 'Closing…'}
            </p>
          </div>
        ) : step === 'FORM' ? (
          <form onSubmit={handleContinue} className="space-y-4">
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>Current rent</span>
              <span className="font-semibold text-foreground">{fmt(currentRent)}/month</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">New rent amount <span className="text-rose-500">*</span></label>
              <input
                type="number" min="1" step="1" value={newRentAmount}
                onChange={(e) => setNewRentAmount(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Apply starting from <span className="text-rose-500">*</span></label>
              {upcomingObligations.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1">
                  No upcoming, unpaid rent installments found — the new rent will still apply to the agreement starting
                  from {monthLabel(effectiveFromMonth)}, and will be used for any rent generated from then on.
                </p>
              ) : (
                <select
                  value={effectiveFromMonth}
                  onChange={(e) => setEffectiveFromMonth(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  {upcomingObligations.map((o) => (
                    <option key={o.id} value={o.rent_month}>{monthLabel(o.rent_month)}</option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-muted-foreground px-1">
                {affectedCount} upcoming installment{affectedCount === 1 ? '' : 's'} will change to {fmt(Number(newRentAmount || 0))}.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Reason <span className="text-rose-500">*</span></label>
              <textarea
                required rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Annual rent increment"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              />
            </div>
            {fieldError && <ErrorCard title="Please check the form" description={fieldError} action="Correct the field above and try again." compact />}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold hover:bg-accent hover:text-accent-foreground active:scale-98 transition-transform">Cancel</button>
              <button type="submit" className="px-4 h-10 rounded-xl bg-accent text-accent-foreground text-sm font-semibold active:scale-98 transition-transform">Continue</button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-2xl p-4 border border-border/40 text-xs space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">New rent</span><span className="font-semibold text-foreground">{fmt(Number(newRentAmount))}/month</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Starting</span><span className="font-semibold text-foreground">{effectiveFromMonth ? monthLabel(effectiveFromMonth) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Installments affected</span><span className="font-semibold text-foreground">{affectedCount}</span></div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Confirm your password <span className="text-rose-500">*</span></label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your login password"
                className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              />
            </div>
            {apiError != null && <ErrorCard error={getHmsError(apiError, 'Change rent')} compact onRetry={() => setApiError(null)} retryLabel="Dismiss" />}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setStep('FORM')} disabled={isSubmitting} className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold disabled:opacity-50">Back</button>
              <button
                type="button" onClick={handleConfirm} disabled={isSubmitting || !password}
                className="px-4 h-10 rounded-xl bg-accent text-accent-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? <StayoLoader size="sm" label={null} /> : null}
                <span>Confirm Change</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
