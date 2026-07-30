import { useState } from 'react';
import { X, CalendarRange, Loader2, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { ErrorCard } from '@/shared/ui/error/ErrorCard';
import { getHmsError } from '@lib/errors';
import { identityService } from '@features/auth/api';
import { ownerService } from '@features/owners/api';

type RecurringFrequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY';

interface FrequencyOption {
  value: RecurringFrequency;
  label: string;
}

const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'HALF_YEARLY', label: 'Half-Yearly' },
];

const FREQUENCY_LABEL: Record<string, string> = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', HALF_YEARLY: 'Half-Yearly', ACADEMIC_YEARLY: 'Academic Yearly', CUSTOM_INSTALLMENTS: 'Custom Dates' };
const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function tomorrowIso(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

interface InstallmentRow {
  id: string;
  due_date: string;
  amount: string;
  label: string;
}

function newRow(): InstallmentRow {
  return { id: crypto.randomUUID(), due_date: tomorrowIso(), amount: '', label: '' };
}

interface ChangeFrequencyModalProps {
  tenantId: string;
  currentFrequency: string;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Owner-direct "Change Billing Frequency" flow — applies immediately, no
 * tenant approval, mirroring ChangeRentModal.tsx's identity-confirmed
 * two-step pattern. Backend still enforces cooldown/clean-period/commitment
 * guards (billing-transition-service.ts) — this modal doesn't relax any of
 * that, it just skips waiting on a tenant-submitted request.
 *
 * Two modes: a recurring cadence (Monthly/Quarterly/Half-Yearly) or a
 * Custom Dates schedule — an explicit owner-entered list of due date +
 * amount installments, not a computed cadence (billing-transition-
 * service.ts::ownerSetCustomSchedule).
 *
 * For agreement-based tenants, changing frequency here also regroups the
 * already-generated future monthly rent into the new cadence directly
 * (ownerInitiateChange — ADR-024), since agreement-rent-schedule-service.ts
 * itself never re-runs for an already-signed agreement and so would
 * otherwise leave the old monthly rows in place forever.
 */
export function ChangeFrequencyModal({ tenantId, currentFrequency, onClose, onSuccess }: ChangeFrequencyModalProps) {
  const recurringOptions = FREQUENCY_OPTIONS.filter((o) => o.value !== currentFrequency);
  const [mode, setMode] = useState<'RECURRING' | 'CUSTOM'>('RECURRING');
  const [requestedFrequency, setRequestedFrequency] = useState<RecurringFrequency>(recurringOptions[0]?.value ?? 'QUARTERLY');
  const [rows, setRows] = useState<InstallmentRow[]>([newRow()]);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'FORM' | 'CONFIRM'>('FORM');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);

  const updateRow = (id: string, patch: Partial<InstallmentRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (id: string) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const customTotal = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (!reason.trim()) {
      setFieldError('Enter a reason for this change.');
      return;
    }
    if (mode === 'CUSTOM') {
      for (const r of rows) {
        if (!r.due_date) { setFieldError('Every installment needs a due date.'); return; }
        if (!(Number(r.amount) > 0)) { setFieldError('Every installment needs an amount greater than 0.'); return; }
      }
      const dates = rows.map((r) => r.due_date);
      if (new Set(dates).size !== dates.length) {
        setFieldError('Installment due dates must be unique.');
        return;
      }
    }
    setStep('CONFIRM');
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setApiError(null);
    setIsSubmitting(true);
    try {
      const identity = await identityService.confirmIdentity(password, 'CHANGE_FREQUENCY');
      const identityToken = identity?.identity_token ?? identity?.data?.identity_token;
      if (!identityToken) throw new Error('Identity verification failed. Invalid password.');

      if (mode === 'CUSTOM') {
        await ownerService.setCustomInstallments(tenantId, {
          installments: rows.map((r) => ({ due_date: r.due_date, amount: Number(r.amount), label: r.label.trim() || undefined })),
          reason: reason.trim(),
          identityToken,
        });
      } else {
        await ownerService.changeFrequency(tenantId, {
          requested_frequency: requestedFrequency,
          reason: reason.trim(),
          identityToken,
        });
      }
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
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <button type="button" onClick={onClose} disabled={isSubmitting} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50">
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
          <div className="p-2 rounded-xl bg-accent/10 text-accent">
            <CalendarRange className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Change Billing Frequency</h3>
            <p className="text-xs text-muted-foreground">Applies immediately — no tenant approval required</p>
          </div>
        </div>

        {succeeded ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-foreground">Billing {mode === 'CUSTOM' ? 'schedule' : 'frequency'} updated</p>
            <p className="text-xs text-muted-foreground">Closing…</p>
          </div>
        ) : step === 'FORM' ? (
          <form onSubmit={handleContinue} className="space-y-4">
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>Current frequency</span>
              <span className="font-semibold text-foreground">{FREQUENCY_LABEL[currentFrequency] || currentFrequency}</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-muted/60">
              <button
                type="button"
                onClick={() => setMode('RECURRING')}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'RECURRING' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                Recurring
              </button>
              <button
                type="button"
                onClick={() => setMode('CUSTOM')}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'CUSTOM' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                Custom Dates
              </button>
            </div>

            {mode === 'RECURRING' ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">New frequency <span className="text-rose-500">*</span></label>
                <select
                  value={requestedFrequency}
                  onChange={(e) => setRequestedFrequency(e.target.value as RecurringFrequency)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  {recurringOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground px-1">
                  Takes effect from the next clean billing period — any in-flight pending/partial charge blocks the change
                  until it's cleared.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">Installments <span className="text-rose-500">*</span></label>
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <div key={row.id} className="flex items-start gap-1.5">
                      <input
                        type="date"
                        value={row.due_date}
                        min={tomorrowIso()}
                        onChange={(e) => updateRow(row.id, { due_date: e.target.value })}
                        className="w-[42%] rounded-xl border border-input bg-background px-2.5 py-2 text-xs"
                      />
                      <input
                        type="number" min="1" step="1" placeholder="Amount"
                        value={row.amount}
                        onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                        className="w-[28%] rounded-xl border border-input bg-background px-2.5 py-2 text-xs placeholder:text-muted-foreground"
                      />
                      <input
                        type="text" placeholder={`Label (optional)`}
                        value={row.label}
                        onChange={(e) => updateRow(row.id, { label: e.target.value })}
                        className="flex-1 rounded-xl border border-input bg-background px-2.5 py-2 text-xs placeholder:text-muted-foreground min-w-0"
                      />
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-600 transition-colors disabled:opacity-30 disabled:hover:text-muted-foreground shrink-0"
                        aria-label={`Remove installment ${i + 1}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addRow}
                  disabled={rows.length >= 24}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-border text-xs font-semibold text-muted-foreground hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add installment
                </button>
                <div className="flex justify-between text-[11px] text-muted-foreground px-1 pt-1">
                  <span>{rows.length} installment{rows.length === 1 ? '' : 's'}</span>
                  <span className="font-semibold text-foreground">Total: {fmt(customTotal)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">
                  Replaces any not-yet-due upcoming rent from the first installment date onward. Blocked if a charge already
                  due or partially paid falls on or after that date.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Reason <span className="text-rose-500">*</span></label>
              <textarea
                required rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={mode === 'CUSTOM' ? 'e.g. Agreed a custom payment plan with the tenant' : 'e.g. Tenant prefers quarterly payments'}
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
              {mode === 'CUSTOM' ? (
                <>
                  {rows.map((r, i) => (
                    <div key={r.id} className="flex justify-between">
                      <span className="text-muted-foreground">{r.label || `Installment ${i + 1}`} · {r.due_date}</span>
                      <span className="font-semibold text-foreground">{fmt(Number(r.amount) || 0)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1.5 border-t border-border/40 font-bold">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-foreground">{fmt(customTotal)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">New frequency</span><span className="font-semibold text-foreground">{FREQUENCY_LABEL[requestedFrequency]}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Reason</span><span className="font-semibold text-foreground text-right max-w-[220px] truncate">{reason}</span></div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Confirm your password <span className="text-rose-500">*</span></label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your login password"
                className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              />
            </div>
            {apiError != null && <ErrorCard error={getHmsError(apiError, 'Change billing frequency')} compact onRetry={() => setApiError(null)} retryLabel="Dismiss" />}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setStep('FORM')} disabled={isSubmitting} className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold disabled:opacity-50">Back</button>
              <button
                type="button" onClick={handleConfirm} disabled={isSubmitting || !password}
                className="px-4 h-10 rounded-xl bg-accent text-accent-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Confirm Change</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
