import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Undo2, CheckCircle2, ArrowRight } from 'lucide-react';
import { ErrorCard } from '@/shared/ui/error/ErrorCard';
import { getHmsError } from '@lib/errors';
import { recoveryService, type CorrectionCase } from '@features/recovery/api';
import { paymentService } from '@features/payments/api';
import { StayoLoader } from '@shared/ui/brand';

interface CorrectPaymentModalProps {
  paymentId: string;
  hostelId: string;
  tenantId: string;
  onClose: () => void;
  onSuccessReverse?: (tenantId: string) => void;
}

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

/**
 * "Correct Payment" flow: pick correction type (Reverse or Transfer to the
 * correct tenant) → reason → preview → confirm (validate + execute treated
 * as one logical confirm step).
 *
 * Consumes the already-built `/api/recovery/cases/*` Correction Case
 * platform. Edit Reference/Notes corrections are out of scope for this
 * modal — see docs/business-logic for the follow-up plan.
 */
export function CorrectPaymentModal({ paymentId, hostelId, tenantId, onClose, onSuccessReverse }: CorrectPaymentModalProps) {
  const [reason, setReason] = useState('');
  const [correctionType, setCorrectionType] = useState<'REVERSE' | 'TRANSFER'>('REVERSE');
  const [toTenantQuery, setToTenantQuery] = useState('');
  const [toTenantId, setToTenantId] = useState<string | null>(null);
  const [toTenantName, setToTenantName] = useState<string | null>(null);
  const [kase, setKase] = useState<CorrectionCase | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);

  const [debouncedToTenantQuery, setDebouncedToTenantQuery] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedToTenantQuery(toTenantQuery), 250);
    return () => clearTimeout(handle);
  }, [toTenantQuery]);

  const { data: toTenantResults, isLoading: toTenantSearchLoading } = useQuery({
    queryKey: ['payments', 'quick-collect', 'search', debouncedToTenantQuery],
    queryFn: () => paymentService.quickCollectSearch(debouncedToTenantQuery),
    enabled: correctionType === 'TRANSFER' && debouncedToTenantQuery.length >= 2 && !toTenantId,
    staleTime: 5000,
  });

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setApiError(null);

    if (!reason.trim()) {
      setFieldError('Enter a reason for this correction.');
      return;
    }
    if (correctionType === 'TRANSFER' && !toTenantId) {
      setFieldError('Search for and select the correct tenant.');
      return;
    }

    setIsPreviewing(true);
    try {
      const created = await recoveryService.createCase({
        hostelId,
        caseType: correctionType === 'TRANSFER' ? 'PAYMENT_TRANSFER' : 'PAYMENT_REVERSAL',
        reason: reason.trim(),
        input: correctionType === 'TRANSFER' ? { paymentId, toTenantId } : { paymentId },
      });
      setKase(created);
    } catch (err) {
      setApiError(err);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleEditReason = () => {
    setKase(null);
    setApiError(null);
    setSucceeded(false);
  };

  const handleConfirm = async () => {
    if (!kase || isConfirming) return;
    setApiError(null);
    setIsConfirming(true);
    try {
      // Treat validate + execute as one logical "confirm" step. If validate
      // rejects (422 — e.g. already reversed, payment gone), the throw here
      // stops us before execute() is ever called.
      await recoveryService.validate(kase.id);
      await recoveryService.execute(kase.id);
      setSucceeded(true);
      if (correctionType === 'REVERSE') {
        onSuccessReverse?.(tenantId);
      }
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setApiError(err);
    } finally {
      setIsConfirming(false);
    }
  };

  const previewImpact = kase?.previewImpact ?? null;
  const isBusy = isPreviewing || isConfirming;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          disabled={isBusy}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
          <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600">
            <Undo2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Correct Payment</h3>
            <p className="text-xs text-muted-foreground">
              {correctionType === 'TRANSFER'
                ? "Moves this payment to the correct tenant's obligations"
                : 'Reverses this payment and re-opens the obligation it settled'}
            </p>
          </div>
        </div>

        {succeeded ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-foreground">
              {correctionType === 'TRANSFER' ? 'Payment transferred' : 'Payment reversed'}
            </p>
            <p className="text-xs text-muted-foreground">Closing…</p>
          </div>
        ) : (
          <>
            {!succeeded && !kase && (
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => { setCorrectionType('REVERSE'); setToTenantId(null); setToTenantName(null); }}
                  className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-colors ${
                    correctionType === 'REVERSE' ? 'bg-rose-600 text-white' : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  Wrong / Reverse
                </button>
                <button
                  type="button"
                  onClick={() => setCorrectionType('TRANSFER')}
                  className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-colors ${
                    correctionType === 'TRANSFER' ? 'bg-rose-600 text-white' : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  Wrong Tenant / Transfer
                </button>
              </div>
            )}

            {!succeeded && !kase && correctionType === 'TRANSFER' && (
              <div className="space-y-1.5 mb-4">
                <label className="text-xs font-semibold text-foreground">
                  Correct tenant <span className="text-rose-500">*</span>
                </label>
                {toTenantId ? (
                  <div className="flex items-center justify-between rounded-xl border border-input bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-semibold text-foreground">{toTenantName}</span>
                    <button
                      type="button"
                      onClick={() => { setToTenantId(null); setToTenantName(null); setToTenantQuery(''); }}
                      className="text-[11px] font-semibold text-accent hover:underline"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={toTenantQuery}
                      onChange={(e) => setToTenantQuery(e.target.value)}
                      placeholder="Search tenant by name or phone"
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    {toTenantSearchLoading && <p className="text-[11px] text-muted-foreground px-1">Searching…</p>}
                    {toTenantResults && toTenantResults.length > 0 && (
                      <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                        {toTenantResults.map((t: any) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => { setToTenantId(t.id); setToTenantName(t.name); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                          >
                            <span className="font-semibold text-foreground">{t.name}</span>
                            <span className="text-muted-foreground ml-2">{t.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <form onSubmit={handlePreview} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Reason for correction <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  disabled={isBusy || Boolean(kase)}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Recorded against the wrong tenant"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {kase && (
                  <button
                    type="button"
                    onClick={handleEditReason}
                    disabled={isBusy}
                    className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-50"
                  >
                    Edit reason &amp; re-preview
                  </button>
                )}
              </div>

              {!kase && (
                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full h-10 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold active:scale-98 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isPreviewing ? <StayoLoader size="sm" label={null} /> : <ArrowRight className="w-4 h-4" />}
                  <span>Preview Impact</span>
                </button>
              )}
            </form>

            {previewImpact && (
              <div className="mt-4 bg-muted/50 rounded-2xl p-4 border border-border/40 space-y-3 text-xs">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">What this correction will do</p>

                {previewImpact.ledgerEntries.length > 0 && (
                  <div className="space-y-1.5">
                    {previewImpact.ledgerEntries.map((entry, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span className="text-muted-foreground">
                          {entry.direction === 'DEBIT' ? 'Debit' : 'Credit'} ledger entry ({entry.reason.replaceAll('_', ' ').toLowerCase()})
                        </span>
                        <span className="font-semibold text-foreground">{fmt(entry.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {previewImpact.obligationChanges.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    {previewImpact.obligationChanges.map((change) => {
                      const before = (change.before as { outstanding?: number } | null)?.outstanding;
                      const after = (change.after as { outstanding?: number } | null)?.outstanding;
                      return (
                        <div key={change.obligationId} className="flex justify-between">
                          <span className="text-muted-foreground">Obligation outstanding</span>
                          <span className="font-semibold text-foreground">
                            {fmt(Number(before ?? 0))} → {fmt(Number(after ?? 0))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {previewImpact.warnings.length > 0 && (
                  <div className="pt-2 border-t border-border/40 space-y-1">
                    {previewImpact.warnings.map((warning, idx) => (
                      <p key={idx} className="text-amber-600 dark:text-amber-400">
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {fieldError && (
              <div className="mt-3">
                <ErrorCard title="Please check the form" description={fieldError} action="Correct the field above and try again." compact />
              </div>
            )}

            {apiError != null && (
              <div className="mt-3">
                <ErrorCard error={getHmsError(apiError, 'Correct payment')} compact onRetry={() => setApiError(null)} retryLabel="Dismiss" />
              </div>
            )}

            <div className="bg-rose-500/5 text-rose-600 dark:text-rose-400 rounded-xl p-3 border border-rose-500/10 text-xs leading-relaxed mt-4">
              <strong>Warning:</strong>{' '}
              {correctionType === 'TRANSFER'
                ? "Transferring moves this payment's ledger entries and obligation allocation to the selected tenant."
                : 'Reversing writes a ledger correction and re-opens the affected obligation.'}{' '}
              This action cannot be undone from here.
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold hover:bg-accent hover:text-accent-foreground active:scale-98 transition-transform disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!kase || isBusy}
                className="px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold active:scale-98 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isConfirming ? <StayoLoader size="sm" label={null} /> : <Undo2 className="w-4 h-4" />}
                <span>{correctionType === 'TRANSFER' ? 'Confirm Transfer' : 'Confirm Reversal'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
