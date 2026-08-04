import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { PAYMENT_MODES, type PaymentMode } from '@shared/mocks/payments';
import type { TenantObligation } from '@shared/mocks/tenants';
import { paymentService } from '@features/payments/api';
import { identityService } from '@features/auth/api';
import { getInitials } from '@features/tenants/utils/normalize';
import { queryKeys } from '@lib/queryKeys';
import type { QuickCollectStep, QuickCollectTenant } from '../types';
import { useNavigate } from 'react-router-dom';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import {
  readPartialPolicy,
  policyHeadline,
  policyDetail,
  outcomeStatements,
  blockedExplanation,
  BILLING_POLICY_PATH,
} from '@features/owner-more/billing-policy/billingPolicy';

interface QuickCollectModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-known tenant (e.g. opened from Tenant Detail — real `obligations`
   *  already loaded, no re-fetch needed). Omit to start on the search step. */
  initialTenant?: QuickCollectTenant;
}

interface QuickCollectSearchResult {
  id: string;
  name: string;
  phone: string;
  hostel_id: string;
  hostel_name: string;
  room_no: string;
  outstanding_dues: number;
  security_deposit_paid: number;
}

interface TenantDueItem {
  obligation_id: string;
  type: string;
  rent_month: string;
  due_date: string;
  outstanding: number;
  status: string;
}

interface SettlementAllocation {
  obligation_id: string;
  label: string;
  allocated: number;
}

interface SettlementPreviewResponse {
  allocations: SettlementAllocation[];
  /** ADR-036: money that could not be placed on any installment — an error, not a balance. */
  unallocated: number;
  total_to_settle: number;
  remaining_outstanding: number;
  payment_accepted: boolean;
  rejection_reason: string | null;
  /** ADR-043 — lets the review step explain the floor rather than just report it. */
  minimum_allowed?: number;
}

const labelStyle = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

function toQuickCollectTenant(r: QuickCollectSearchResult): QuickCollectTenant {
  return {
    id: r.id,
    name: r.name,
    initials: getInitials(r.name),
    phone: r.phone,
    hostelId: r.hostel_id,
    hostelName: r.hostel_name,
    room: r.room_no,
    outstanding: r.outstanding_dues,
    deposit: r.security_deposit_paid,
  };
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function toObligation(item: TenantDueItem): TenantObligation {
  return {
    id: item.obligation_id,
    type: item.type,
    month: formatDate(item.rent_month),
    amount: item.outstanding,
    dueLabel: `Due: ${formatDate(item.due_date)}`,
    status: (['PENDING', 'UPCOMING', 'PAID', 'OVERDUE'].includes(item.status) ? item.status : 'PENDING') as TenantObligation['status'],
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * 5-step Quick Collect payment flow, per Stayo App.dc.html. Real end-to-end:
 * `GET /payments/quick-collect/search` (select), `GET /payments/settlement-
 * preview` (preview — the real FIFO settlement engine, not client math),
 * `POST /auth/confirm-identity` + `POST /payments/record-offline` (password
 * → confirm). "Customize" mode's obligation checklist is either the caller's
 * already-loaded `initialTenant.obligations` (Tenant Detail) or lazily
 * fetched via `GET /payments/tenant-dues` (Money tab entry points).
 */
export function QuickCollectModal({ open, onClose, initialTenant }: QuickCollectModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<QuickCollectStep>('select');
  const [search, setSearch] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<QuickCollectTenant | undefined>(initialTenant);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'suggested' | 'customize'>('suggested');
  const [selectedObligationIds, setSelectedObligationIds] = useState<string[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(initialTenant ? 'amount' : 'select');
    setSelectedTenant(initialTenant);
    setSearch('');
    setAmount('');
    setMode('suggested');
    setSelectedObligationIds([]);
    setPaymentMode('Cash');
    setDate(new Date().toISOString().slice(0, 10));
    setNote('');
    setPassword('');
    setPasswordError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTenant?.id]);

  const searchQuery = useQuery({
    queryKey: ['owner', 'quick-collect-search', search],
    queryFn: () => paymentService.quickCollectSearch(search) as Promise<QuickCollectSearchResult[]>,
    enabled: open && step === 'select',
    staleTime: 15_000,
  });
  const searchResults = searchQuery.data ?? [];

  const duesQuery = useQuery({
    queryKey: ['owner', 'tenant-dues', selectedTenant?.id],
    queryFn: () => paymentService.getTenantDues(selectedTenant!.id, selectedTenant!.hostelId) as Promise<{ items: TenantDueItem[] }>,
    enabled: Boolean(selectedTenant?.id) && !selectedTenant?.obligations,
    staleTime: 30_000,
  });

  const payableObligations = useMemo(
    () => selectedTenant?.obligations ?? (duesQuery.data?.items ?? []).map(toObligation),
    [selectedTenant, duesQuery.data],
  );

  useEffect(() => {
    setSelectedObligationIds(payableObligations.map((o) => o.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id, payableObligations.length]);

  /**
   * What this amount will actually do, shown before Preview rather than after.
   * The over-payment case describes real backend behaviour (ADR-036): there is
   * no future-rent-credit balance any more — paying ahead generates the next
   * installment and settles it.
   */
  const amountConsequence = useMemo(() => {
    const entered = Number(amount);
    const outstanding = selectedTenant?.outstanding ?? 0;
    if (!entered) return 'Enter an amount, or tap a shortcut above.';
    if (entered < outstanding) {
      return `₹${(outstanding - entered).toLocaleString('en-IN')} will remain outstanding.`;
    }
    if (entered === outstanding) return 'Clears all dues.';
    return `Clears all dues. ₹${(entered - outstanding).toLocaleString('en-IN')} goes to the next installment, which is created if it doesn't exist yet.`;
  }, [amount, selectedTenant?.outstanding]);

  // The hostel's billing policy, so the owner is told the rule *before* they
  // type an amount rather than being refused after (ADR-043). Reuses the
  // existing preferences endpoint — the settlement preview can't serve this
  // because it requires an amount > 0.
  const hostelPolicyQuery = useHostelPolicy(selectedTenant?.hostelId ?? null);
  const partialPolicy = readPartialPolicy(hostelPolicyQuery.data?.policy);

  const previewQuery = useQuery({
    queryKey: ['owner', 'settlement-preview', selectedTenant?.id, amount, mode, [...selectedObligationIds].sort()],
    queryFn: () =>
      paymentService.settlementPreview(
        selectedTenant!.id,
        Number(amount),
        selectedTenant!.hostelId,
        mode === 'customize' ? selectedObligationIds : undefined,
      ) as Promise<SettlementPreviewResponse>,
    // Also live on the amount step: the owner should see exactly where the
    // money lands *while* choosing it, not only after committing to Preview.
    enabled: (step === 'amount' || step === 'preview') && Boolean(selectedTenant?.id) && Number(amount) > 0,
  });
  const preview = previewQuery.data;
  const allocations = (preview?.allocations ?? []).filter((a) => a.allocated > 0);

  /** Outstanding per obligation, so the review step can show before → after. */
  const obligationOutstanding = useMemo(
    () => new Map(payableObligations.map((o) => [o.id, o.amount])),
    [payableObligations],
  );

  const { clearedCount, partialCount } = useMemo(() => {
    let cleared = 0;
    let partial = 0;
    for (const a of allocations) {
      const before = obligationOutstanding.get(a.obligation_id) ?? 0;
      if (before - a.allocated <= 0) cleared += 1;
      else partial += 1;
    }
    return { clearedCount: cleared, partialCount: partial };
  }, [allocations, obligationOutstanding]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const identity = await identityService.confirmIdentity(password, 'OFFLINE_PAYMENT');
      return paymentService.recordTenantPayment({
        identityToken: identity.identity_token,
        tenantId: selectedTenant!.id,
        amountPaid: Number(amount),
        paymentMethod: paymentMode.toUpperCase().replace(' ', '_'),
        paymentDate: date,
        note: note.trim() || undefined,
        hostelId: selectedTenant!.hostelId,
        allowedObligationIds: mode === 'customize' ? selectedObligationIds : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant'] });
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant-dues'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all(selectedTenant!.hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
      setPasswordError(false);
      setStep('success');
    },
    onError: () => setPasswordError(true),
  });

  const selectTenant = (t: QuickCollectTenant) => {
    setSelectedTenant(t);
    setStep('amount');
  };

  const toggleObligation = (id: string) => {
    setSelectedObligationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const goPreview = () => {
    if (!amount.trim() || Number(amount) <= 0) return;
    setStep('preview');
  };

  const confirmPassword = () => {
    if (!password.trim()) {
      setPasswordError(true);
      return;
    }
    confirmMutation.mutate();
  };

  const title = { select: 'Collect Payment', amount: 'Collect Payment', preview: 'Review payment', password: 'Confirm', success: 'Done' }[step];
  const subtitle = selectedTenant ? `${selectedTenant.hostelName} · Room ${selectedTenant.room}` : 'Search for a tenant to begin';

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col">
          <span>{title}</span>
          <span className="text-[11.5px] font-normal text-muted-foreground">{subtitle}</span>
        </span>
      }
      footer={
        step === 'select' ? undefined : (
          <div className="flex gap-2.5">
            {step === 'amount' && !initialTenant && (
              <button type="button" onClick={() => setStep('select')} className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground">
                Back
              </button>
            )}
            {step === 'preview' && (
              <button type="button" onClick={() => setStep('amount')} className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground">
                Back
              </button>
            )}
            {step === 'password' && (
              <button type="button" onClick={() => setStep('preview')} className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground">
                Back
              </button>
            )}
            <button
              type="button"
              disabled={
                (step === 'preview' && (previewQuery.isLoading || preview?.payment_accepted === false)) ||
                (step === 'password' && confirmMutation.isPending)
              }
              onClick={
                step === 'amount' ? goPreview : step === 'preview' ? () => setStep('password') : step === 'password' ? confirmPassword : onClose
              }
              className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {step === 'amount' && 'Preview'}
              {step === 'preview' && 'Confirm'}
              {step === 'password' && (confirmMutation.isPending ? 'Confirming…' : 'Confirm payment')}
              {step === 'success' && 'Done'}
            </button>
          </div>
        )
      }
    >
      {step === 'select' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tenant by name, room, phone…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground focus:outline-none"
            />
          </div>
          {searchQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Searching…</p>
          ) : searchResults.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No tenants found.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {searchResults.map((r) => {
                const t = toQuickCollectTenant(r);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTenant(t)}
                    className="flex items-start gap-2.5 rounded-2xl border border-border bg-card p-3 text-left"
                  >
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-secondary font-display text-xs font-bold text-primary">
                      {t.initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-display text-sm font-bold text-foreground">{t.name}</span>
                        <div className="flex flex-none flex-col items-end">
                          <span className="text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">Outstanding</span>
                          <span className={`font-display text-[13px] font-bold tabular-nums ${t.outstanding > 0 ? 'text-destructive' : 'text-success'}`}>
                            ₹{t.outstanding.toLocaleString('en-IN')}
                          </span>
                        </div>
                      </div>
                      <span className="mt-1 inline-block rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {t.hostelName} · {t.room}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 'amount' && selectedTenant && (
        <div className="flex flex-col gap-4">
          {/* The policy, stated up front. Previously the owner learned about it
              only at the review step, as a refusal (ADR-043). */}
          <div
            className={`rounded-xl border px-3.5 py-2.5 ${
              partialPolicy.enabled ? 'border-border bg-muted/40' : 'border-warning/30 bg-warning/10'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-[12px] font-bold text-foreground">
                {policyHeadline(partialPolicy)}
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(BILLING_POLICY_PATH);
                }}
                className="flex-none text-[11.5px] font-semibold text-primary"
              >
                Change
              </button>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {policyDetail(partialPolicy)}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <div className="flex gap-2.5">
                <span className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-[11px] bg-secondary font-display text-xs font-bold text-primary">
                  {selectedTenant.initials}
                </span>
                <div>
                  <div className="font-display text-[15px] font-bold text-foreground">{selectedTenant.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">{selectedTenant.phone}</div>
                  <span className="mt-1 inline-block rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {selectedTenant.hostelName} · {selectedTenant.room}
                  </span>
                </div>
              </div>
              {!initialTenant && (
                <button type="button" onClick={() => setStep('select')} className="flex-none rounded-lg bg-foreground px-3 py-1.5 font-display text-[11.5px] font-bold text-background">
                  Change
                </button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Outstanding</span>
                <span className={`font-display text-[13px] font-bold ${selectedTenant.outstanding > 0 ? 'text-destructive' : 'text-success'}`}>
                  ₹{selectedTenant.outstanding.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Deposit</span>
                <span className="font-display text-[12.5px] font-bold text-foreground">₹{selectedTenant.deposit.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          <label className="block">
            <span className={labelStyle}>Amount Received *</span>
            <div className="mt-1.5 flex items-center rounded-xl border-[1.5px] border-primary bg-card px-3.5">
              <span className="text-base font-bold text-primary">₹</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Enter any amount" className="flex-1 min-w-0 bg-transparent px-2 py-3 font-display text-base font-bold text-foreground focus:outline-none" />
            </div>

            {/* Collecting the full outstanding is the common case — one tap
                instead of typing it out on a phone. */}
            {selectedTenant.outstanding > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { label: `Full ₹${selectedTenant.outstanding.toLocaleString('en-IN')}`, value: selectedTenant.outstanding },
                  { label: `Half ₹${Math.round(selectedTenant.outstanding / 2).toLocaleString('en-IN')}`, value: Math.round(selectedTenant.outstanding / 2) },
                ].map((chip) => {
                  const active = Number(amount) === chip.value;
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setAmount(String(chip.value))}
                      className={`rounded-full border px-3 py-1.5 font-display text-[12px] font-bold transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:border-primary'
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mt-1.5 text-[11px] text-muted-foreground">{amountConsequence}</p>
          </label>

          <div className="flex rounded-xl bg-muted p-1">
            {(['suggested', 'customize'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg py-2 text-center font-display text-[12.5px] font-bold ${mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                {m === 'suggested' ? 'Suggested Settlement' : 'Customize'}
              </button>
            ))}
          </div>

          {/* Live settlement breakdown — shows exactly which installment each
              rupee lands on, updating as the amount or selection changes, so
              the owner never has to reach Preview to find out. */}
          {Number(amount) > 0 && (
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-display text-[10.5px] font-bold uppercase tracking-wider text-primary">
                  {mode === 'suggested' ? 'Suggested settlement' : 'This selection settles'}
                </span>
                {previewQuery.isFetching && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                )}
              </div>

              {previewQuery.isError ? (
                <p className="text-[11.5px] text-muted-foreground">Could not work out the split. It will be shown on the next step.</p>
              ) : allocations.length === 0 ? (
                <p className="text-[11.5px] text-muted-foreground">
                  {previewQuery.isFetching ? 'Working out where this goes…' : 'Nothing to settle with this amount.'}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    {allocations.map((a, i) => (
                      <div key={a.obligation_id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-[12.5px] text-foreground">
                          <span className="mr-1.5 font-display text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                          {a.label}
                        </span>
                        <span className="flex-none font-display text-[12.5px] font-bold tabular-nums text-success">
                          ₹{a.allocated.toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                  {(preview?.remaining_outstanding ?? 0) > 0 && (
                    <div className="mt-2 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
                      ₹{(preview?.remaining_outstanding ?? 0).toLocaleString('en-IN')} still outstanding after this
                    </div>
                  )}
                  {preview?.payment_accepted === false && preview?.rejection_reason && (
                    <div className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11.5px] font-semibold text-destructive">
                      {preview.rejection_reason}
                    </div>
                  )}
                </>
              )}
              <p className="mt-2 text-[10.5px] leading-normal text-muted-foreground">
                Rent is always settled oldest first, so nothing older is left behind.
              </p>
            </div>
          )}

          {mode === 'customize' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className={labelStyle}>Select obligations to settle</span>
                <button
                  type="button"
                  onClick={() => setSelectedObligationIds(selectedObligationIds.length === payableObligations.length ? [] : payableObligations.map((o) => o.id))}
                  className="font-display text-[11.5px] font-bold text-primary"
                >
                  {selectedObligationIds.length === payableObligations.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              {duesQuery.isLoading && !selectedTenant.obligations ? (
                <p className="py-4 text-center text-[12.5px] text-muted-foreground">Loading obligations…</p>
              ) : (
                <div className="flex max-h-[220px] flex-col gap-2 overflow-y-auto">
                  {payableObligations.map((ob) => {
                    const checked = selectedObligationIds.includes(ob.id);
                    return (
                      <button
                        key={ob.id}
                        type="button"
                        onClick={() => toggleObligation(ob.id)}
                        className={`flex items-center justify-between rounded-xl border p-3 text-left ${checked ? 'border-primary bg-secondary/40' : 'border-border bg-card'}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-[5px] border-2 ${checked ? 'border-primary bg-primary' : 'border-border'}`}>
                            {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3.5} />}
                          </span>
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-foreground">{ob.type}</div>
                            <div className="text-[11px] text-muted-foreground">{ob.month}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-display text-[13.5px] font-bold tabular-nums text-foreground">₹{ob.amount.toLocaleString('en-IN')}</div>
                          <div className="text-[10px] text-muted-foreground">{ob.dueLabel}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-[11px] leading-relaxed text-warning">
                Rent dues of the same type must be paid in chronological order. Selecting a newer rent due will automatically select older ones.
              </div>
            </div>
          )}

          <label className="block">
            <span className={labelStyle}>Payment Mode *</span>
            <div className="mt-1.5 flex gap-2">
              {PAYMENT_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMode(m)}
                  className={`flex-1 rounded-xl border-[1.5px] py-2.5 text-center font-display text-[12.5px] font-bold ${paymentMode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className={labelStyle}>Payment Date *</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5 w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none" />
          </label>

          <label className="block">
            <span className={labelStyle}>Note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any notes about this payment…"
              className="mt-1.5 min-h-[56px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </label>
        </div>
      )}

      {step === 'preview' && selectedTenant && (
        <div className="flex flex-col gap-3">
          {previewQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Calculating settlement…</p>
          ) : preview ? (
            <>
              {preview.payment_accepted === false ? (
                (() => {
                  const blocked = blockedExplanation({
                    policy: partialPolicy,
                    minimumAllowed: preview.minimum_allowed ?? 0,
                    entered: Number(amount) || 0,
                  });
                  return (
                    <div className="flex flex-col gap-3">
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5">
                        <div className="font-display text-[13px] font-bold text-destructive">{blocked.title}</div>
                        <p className="mt-1 text-[12px] leading-relaxed text-destructive/90">{blocked.body}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setStep('amount')}
                          className="flex-1 rounded-xl border border-border bg-card py-3 text-center font-display text-[13px] font-bold text-foreground"
                        >
                          Change amount
                        </button>
                        {blocked.canFixInSettings && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              navigate(BILLING_POLICY_PATH);
                            }}
                            className="flex-1 rounded-xl border border-border bg-card py-3 text-center font-display text-[13px] font-bold text-primary"
                          >
                            Billing policy
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
              <>
              {/* One line of arithmetic, then the settlement itself. The old
                  version led with three abstract stat tiles and hid the actual
                  allocation behind a disclosure. */}
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                <b className="text-foreground">₹{Number(amount).toLocaleString('en-IN')}</b> received
                {allocations.length > 0 && (
                  <>
                    {' '}→ settles{' '}
                    <b className="text-foreground">
                      {allocations.length} installment{allocations.length > 1 ? 's' : ''}
                    </b>
                  </>
                )}
              </p>

              <div className="flex flex-col gap-2">
                {allocations.length === 0 ? (
                  <p className="rounded-xl border border-border bg-muted/40 p-3 text-[12.5px] text-muted-foreground">
                    This amount settles nothing — go back and pick a different amount.
                  </p>
                ) : (
                  allocations.map((row) => {
                    const before = obligationOutstanding.get(row.obligation_id) ?? 0;
                    const after = Math.max(before - row.allocated, 0);
                    const cleared = after <= 0;
                    return (
                      <div key={row.obligation_id} className="rounded-xl border border-border bg-card p-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-display text-[13.5px] font-bold text-foreground">{row.label}</span>
                          <span className="flex-none font-display text-[13.5px] font-bold tabular-nums text-success">
                            +₹{row.allocated.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11.5px]">
                          <span className="text-muted-foreground line-through">₹{before.toLocaleString('en-IN')} due</span>
                          <span className="text-muted-foreground">→</span>
                          {cleared ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-bold text-success">
                              <Check className="h-3 w-3" strokeWidth={3} />
                              Cleared
                            </span>
                          ) : (
                            <span className="font-bold text-destructive">₹{after.toLocaleString('en-IN')} still due</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* What confirming actually changes. */}
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="mb-1.5 font-display text-[10.5px] font-bold uppercase tracking-wider text-primary">
                  After confirming
                </div>
                <ul className="flex flex-col gap-1 text-[12px] text-foreground">
                  {outcomeStatements({
                    collected: preview.total_to_settle,
                    remaining: preview.remaining_outstanding,
                    clearedCount,
                    partialCount,
                  }).map((line, i, arr) => (
                    <li key={line} className={i === arr.length - 1 ? 'text-muted-foreground' : undefined}>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
              </>
              )}
            </>
          ) : (
            <p className="py-8 text-center text-sm text-destructive">Could not calculate settlement. Please go back and try again.</p>
          )}
        </div>
      )}

      {step === 'password' && selectedTenant && (
        <div className="flex flex-col items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary font-display text-lg font-bold text-primary">••</span>
          <p className="font-display text-base font-extrabold text-foreground">Confirm with your password</p>
          <p className="max-w-[280px] text-center text-[12.5px] leading-relaxed text-muted-foreground">
            For security, recording <b className="text-foreground">₹{(Number(amount) || 0).toLocaleString('en-IN')}</b> for{' '}
            <b className="text-foreground">{selectedTenant.name}</b> requires your account password.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="mt-1 w-full rounded-[14px] border-[1.5px] border-border bg-card px-4 py-3.5 text-center text-[15px] font-semibold tracking-widest text-foreground focus:border-primary focus:outline-none"
          />
          {passwordError && (
            <p className="text-[11.5px] font-semibold text-destructive">
              {confirmMutation.isError
                ? getErrorMessage(confirmMutation.error, 'Could not record the payment. Please try again.')
                : 'Please enter your password to continue.'}
            </p>
          )}
        </div>
      )}

      {step === 'success' && selectedTenant && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <Check className="h-7 w-7 text-success" strokeWidth={3} />
          </span>
          <p className="font-display text-lg font-extrabold text-foreground">Payment recorded</p>
          <p className="text-[12.5px] text-muted-foreground">
            ₹{(Number(amount) || 0).toLocaleString('en-IN')} collected from {selectedTenant.name}
          </p>
        </div>
      )}
    </BottomSheet>
  );
}
