import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { PAYMENT_MODES, type PaymentMode } from '@shared/mocks/payments';
import { moveOutService } from '@features/move-out/api';
import { canonicalMoveOutStatus } from '@shared/types/moveout';
import { queryKeys } from '@lib/queryKeys';

interface MoveOutSheetProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  hostelId: string;
  tenantName: string;
}

const REASON_LABEL: Record<string, string> = {
  COURSE_COMPLETED: 'Course completed',
  JOB_RELOCATION: 'Job relocation',
  TOO_EXPENSIVE: 'Too expensive',
  POOR_MAINTENANCE: 'Poor maintenance',
  FOOD_QUALITY: 'Food quality',
  ROOMMATE_ISSUES: 'Roommate issues',
  BETTER_HOSTEL: 'Found a better hostel',
  PERSONAL_REASONS: 'Personal reasons',
  SAFETY_CONCERNS: 'Safety concerns',
  RULES_TOO_STRICT: 'Rules too strict',
  MOVING_CLOSER: 'Moving closer to work/college',
  OTHER: 'Other',
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested — awaiting inspection',
  SETTLEMENT_PENDING: 'Inspection done — settlement pending approval',
  SETTLEMENT_APPROVED: 'Settlement approved — awaiting vacate',
  PHYSICALLY_VACATED: 'Vacated — awaiting payment confirmation',
  SETTLEMENT_PENDING_PAYMENT: 'Awaiting payment confirmation',
  COMPLETED: 'Move-out completed',
  REJECTED: 'Request rejected',
};

const labelStyle = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'mt-1.5 w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

interface MoveOutRequest {
  id: string;
  status: string;
  planned_exit_date: string;
  reason: string;
  reason_text: string | null;
  settlement_preview: {
    net_settlement_amount: number;
    settlement_direction: 'OWNER_OWES_TENANT' | 'TENANT_OWES_OWNER' | 'SETTLED';
    total_dues: number;
    total_deductions: number;
    security_deposit_amount: number;
    advance_balance: number;
  } | null;
  disputes: { id: string; status: string }[];
}

/**
 * Real Move-out / Checkout flow: looks up whether the tenant already has a
 * request, and if not offers "Initiate Move Out"; if so, drives the real
 * `moveOutService` state machine one stage at a time (REQUESTED → inspect →
 * SETTLEMENT_PENDING → settle → SETTLEMENT_APPROVED → vacate →
 * PHYSICALLY_VACATED → complete → COMPLETED), matching the pipeline in
 * `MoveOutStepper`/the (orphaned) `MoveOutsView.tsx`. Open disputes are
 * flagged but not resolved here — that's a separate, rarer flow, deferred.
 */
export function MoveOutSheet({ open, onClose, tenantId, hostelId, tenantName }: MoveOutSheetProps) {
  const queryClient = useQueryClient();

  // -- new-request form state --
  const [plannedExitDate, setPlannedExitDate] = useState(todayValue());
  const [reason, setReason] = useState('PERSONAL_REASONS');
  const [reasonText, setReasonText] = useState('');

  // -- inspection form state --
  const [roomCondition, setRoomCondition] = useState<'GOOD' | 'FAIR' | 'POOR'>('GOOD');
  const [cleaningStatus, setCleaningStatus] = useState<'CLEAN' | 'NEEDS_CLEANING'>('CLEAN');
  const [damagesAmount, setDamagesAmount] = useState('0');
  const [cleaningFee, setCleaningFee] = useState('0');
  const [missingItemsFee, setMissingItemsFee] = useState('0');
  const [otherDeductions, setOtherDeductions] = useState('0');
  const [deductionNotes, setDeductionNotes] = useState('');

  // -- settle / vacate / complete state --
  const [reviewNotes, setReviewNotes] = useState('');
  const [physicalExitDate, setPhysicalExitDate] = useState(todayValue());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  useEffect(() => {
    if (open) {
      setPlannedExitDate(todayValue());
      setReason('PERSONAL_REASONS');
      setReasonText('');
      setRoomCondition('GOOD');
      setCleaningStatus('CLEAN');
      setDamagesAmount('0');
      setCleaningFee('0');
      setMissingItemsFee('0');
      setOtherDeductions('0');
      setDeductionNotes('');
      setReviewNotes('');
      setPhysicalExitDate(todayValue());
      setPaymentMode('Cash');
      setPaymentReference('');
      setPaymentNotes('');
    }
  }, [open]);

  const listQuery = useQuery({
    queryKey: queryKeys.tenants.moveOut(hostelId, tenantId),
    queryFn: () => moveOutService.listRequests(hostelId, { limit: 50 }) as Promise<{ requests: Array<{ id: string; tenant_id: string; status: string }> }>,
    enabled: open,
    staleTime: 15_000,
  });

  const existingRequestId = useMemo(
    () => listQuery.data?.requests.find((r) => r.tenant_id === tenantId)?.id,
    [listQuery.data, tenantId],
  );

  const detailQuery = useQuery({
    queryKey: ['owner', 'move-out', 'detail', existingRequestId],
    queryFn: () => moveOutService.getRequest(existingRequestId!) as Promise<MoveOutRequest>,
    enabled: Boolean(existingRequestId),
    staleTime: 10_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tenants.moveOut(hostelId, tenantId) });
    queryClient.invalidateQueries({ queryKey: ['owner', 'move-out'] });
    queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
    queryClient.invalidateQueries({ queryKey: ['owner', 'tenants'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
  };

  const submitMutation = useMutation({
    mutationFn: () => moveOutService.submitRequest({ hostelId, tenantId, reason, reasonText: reasonText.trim() || undefined, plannedExitDate }),
    onSuccess: invalidate,
  });

  const inspectMutation = useMutation({
    mutationFn: () =>
      moveOutService.inspect(existingRequestId!, {
        roomCondition,
        cleaningStatus,
        damagesAmount: Number(damagesAmount) || 0,
        cleaningFee: Number(cleaningFee) || 0,
        missingItemsFee: Number(missingItemsFee) || 0,
        otherDeductions: Number(otherDeductions) || 0,
        deductionNotes: deductionNotes.trim() || undefined,
      }),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: () => moveOutService.reject(existingRequestId!, { reason: 'Owner declined the move-out request' }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const settleMutation = useMutation({
    mutationFn: () => moveOutService.settle(existingRequestId!, { reviewNotes: reviewNotes.trim() || undefined }),
    onSuccess: invalidate,
  });

  const vacateMutation = useMutation({
    mutationFn: () => moveOutService.vacate(existingRequestId!, { physicalExitDate }),
    onSuccess: invalidate,
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      moveOutService.complete(existingRequestId!, {
        paymentMethod: paymentMode.toUpperCase().replace(' ', '_'),
        paymentReference: paymentReference.trim() || undefined,
        paymentNotes: paymentNotes.trim() || undefined,
      }),
    onSuccess: invalidate,
  });

  const isLoading = listQuery.isLoading || (Boolean(existingRequestId) && detailQuery.isLoading);
  const request = detailQuery.data;
  const status = request ? canonicalMoveOutStatus(request.status) : null;
  const hasOpenDispute = (request?.disputes ?? []).some((d) => d.status !== 'RESOLVED' && d.status !== 'REJECTED');

  const activeError = submitMutation.error ?? inspectMutation.error ?? rejectMutation.error ?? settleMutation.error ?? vacateMutation.error ?? completeMutation.error;

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={`Move Out · ${tenantName}`}>
      <div className="flex flex-col gap-4">
        {activeError ? (
          <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
            {getErrorMessage(activeError, 'Something went wrong. Please try again.')}
          </p>
        ) : null}

        {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && !existingRequestId && (
          <>
            <p className="text-[12.5px] text-muted-foreground">No move-out request exists yet for {tenantName}. Starting one begins the checkout & settlement process.</p>
            <label className="block">
              <span className={labelStyle}>Planned Exit Date *</span>
              <input type="date" value={plannedExitDate} onChange={(e) => setPlannedExitDate(e.target.value)} className={inputStyle} />
            </label>
            <label className="block">
              <span className={labelStyle}>Reason *</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputStyle}>
                {Object.entries(REASON_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelStyle}>Notes (optional)</span>
              <textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                className="mt-1.5 min-h-[64px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            <button
              type="button"
              disabled={submitMutation.isPending || !plannedExitDate}
              onClick={() => submitMutation.mutate()}
              className="rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {submitMutation.isPending ? 'Submitting…' : 'Initiate Move Out'}
            </button>
          </>
        )}

        {!isLoading && request && status && (
          <>
            <div className="rounded-2xl border border-border bg-card p-3.5">
              <div className={labelStyle}>Status</div>
              <div className="mt-1 font-display text-[14px] font-bold text-foreground">{STATUS_LABEL[status] ?? status}</div>
              <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                Planned exit: {request.planned_exit_date?.slice(0, 10)} · Reason: {REASON_LABEL[request.reason] ?? request.reason}
              </div>
            </div>

            {hasOpenDispute && (
              <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-[12px] font-semibold text-warning">
                This move-out has an open dispute. Resolve it before continuing (not available in this view yet).
              </p>
            )}

            {!hasOpenDispute && status === 'REQUESTED' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={labelStyle}>Room Condition</span>
                    <select value={roomCondition} onChange={(e) => setRoomCondition(e.target.value as typeof roomCondition)} className={inputStyle}>
                      <option value="GOOD">Good</option>
                      <option value="FAIR">Fair</option>
                      <option value="POOR">Poor</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelStyle}>Cleaning</span>
                    <select value={cleaningStatus} onChange={(e) => setCleaningStatus(e.target.value as typeof cleaningStatus)} className={inputStyle}>
                      <option value="CLEAN">Clean</option>
                      <option value="NEEDS_CLEANING">Needs cleaning</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={labelStyle}>Damages (₹)</span>
                    <input value={damagesAmount} onChange={(e) => setDamagesAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={inputStyle} />
                  </label>
                  <label className="block">
                    <span className={labelStyle}>Cleaning Fee (₹)</span>
                    <input value={cleaningFee} onChange={(e) => setCleaningFee(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={inputStyle} />
                  </label>
                  <label className="block">
                    <span className={labelStyle}>Missing Items (₹)</span>
                    <input value={missingItemsFee} onChange={(e) => setMissingItemsFee(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={inputStyle} />
                  </label>
                  <label className="block">
                    <span className={labelStyle}>Other Deductions (₹)</span>
                    <input value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={inputStyle} />
                  </label>
                </div>
                <label className="block">
                  <span className={labelStyle}>Deduction Notes (optional)</span>
                  <textarea value={deductionNotes} onChange={(e) => setDeductionNotes(e.target.value)} className="mt-1.5 min-h-[56px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none" />
                </label>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    disabled={rejectMutation.isPending || inspectMutation.isPending}
                    onClick={() => rejectMutation.mutate()}
                    className="flex-1 rounded-xl border border-destructive/25 py-3.5 text-center font-display text-sm font-bold text-destructive disabled:opacity-50"
                  >
                    {rejectMutation.isPending ? 'Rejecting…' : 'Reject request'}
                  </button>
                  <button
                    type="button"
                    disabled={inspectMutation.isPending}
                    onClick={() => inspectMutation.mutate()}
                    className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                  >
                    {inspectMutation.isPending ? 'Saving…' : 'Submit Inspection'}
                  </button>
                </div>
              </>
            )}

            {!hasOpenDispute && status === 'SETTLEMENT_PENDING' && request.settlement_preview && (
              <>
                <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3.5">
                  <Row label="Total dues" value={`₹${request.settlement_preview.total_dues.toLocaleString('en-IN')}`} />
                  <Row label="Deductions" value={`₹${request.settlement_preview.total_deductions.toLocaleString('en-IN')}`} />
                  <Row label="Security deposit held" value={`₹${request.settlement_preview.security_deposit_amount.toLocaleString('en-IN')}`} />
                  <div className="mt-1 flex justify-between border-t border-border pt-2">
                    <span className="font-display text-[13px] font-bold text-foreground">
                      {request.settlement_preview.settlement_direction === 'OWNER_OWES_TENANT' ? 'Refund to tenant' : request.settlement_preview.settlement_direction === 'TENANT_OWES_OWNER' ? 'Owed by tenant' : 'Settled'}
                    </span>
                    <span className="font-display text-[15px] font-extrabold tabular-nums text-primary">
                      ₹{Math.abs(request.settlement_preview.net_settlement_amount).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
                <label className="block">
                  <span className={labelStyle}>Review Notes (optional)</span>
                  <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} className="mt-1.5 min-h-[56px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none" />
                </label>
                <button
                  type="button"
                  disabled={settleMutation.isPending}
                  onClick={() => settleMutation.mutate()}
                  className="rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {settleMutation.isPending ? 'Approving…' : 'Approve Settlement'}
                </button>
              </>
            )}

            {!hasOpenDispute && status === 'SETTLEMENT_APPROVED' && (
              <>
                <label className="block">
                  <span className={labelStyle}>Physical Exit Date *</span>
                  <input type="date" value={physicalExitDate} onChange={(e) => setPhysicalExitDate(e.target.value)} className={inputStyle} />
                </label>
                <button
                  type="button"
                  disabled={vacateMutation.isPending}
                  onClick={() => vacateMutation.mutate()}
                  className="rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {vacateMutation.isPending ? 'Saving…' : 'Vacate & Release Bed'}
                </button>
              </>
            )}

            {!hasOpenDispute && (status === 'PHYSICALLY_VACATED' || status === 'SETTLEMENT_PENDING_PAYMENT') && (
              <>
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
                  <span className={labelStyle}>Reference (optional)</span>
                  <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} className={inputStyle} />
                </label>
                <label className="block">
                  <span className={labelStyle}>Notes (optional)</span>
                  <textarea value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} className="mt-1.5 min-h-[56px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none" />
                </label>
                <button
                  type="button"
                  disabled={completeMutation.isPending}
                  onClick={() => completeMutation.mutate()}
                  className="rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {completeMutation.isPending ? 'Confirming…' : 'Confirm Refund & Complete'}
                </button>
              </>
            )}

            {(status === 'COMPLETED' || status === 'REJECTED') && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <span className={`flex h-14 w-14 items-center justify-center rounded-full ${status === 'COMPLETED' ? 'bg-success/15' : 'bg-destructive/15'}`}>
                  <Check className={`h-6 w-6 ${status === 'COMPLETED' ? 'text-success' : 'text-destructive'}`} strokeWidth={3} />
                </span>
                <p className="font-display text-base font-extrabold text-foreground">{STATUS_LABEL[status]}</p>
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
