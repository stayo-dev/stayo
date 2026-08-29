import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, ChevronDown } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { PAYMENT_MODES, type PaymentMode } from '@shared/mocks/payments';
import { moveOutService } from '@features/move-out/api';
import { queryKeys } from '@lib/queryKeys';
import {
  buildConsequences,
  canonicalStatus,
  completionLabel,
  decideLane,
  exitProgress,
  humaniseServerError,
  moveOutBlock,
  resolveActiveRequest,
  summariseSettlement,
  type DuesDisposition,
  type SettlementPreview,
} from './moveOutPlan';

interface MoveOutSheetProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  hostelId: string;
  tenantName: string;
  roomNo?: string | null;
  /** The tenancy's status. Decides whether an exit can be started at all. */
  tenantStatus?: string | null;
}

/**
 * Owner-side move-out.
 *
 * Two lanes over one state machine (ADR-122). The common exit — a tenant
 * whose course ended and who has already gone — is one screen and one tap:
 * the settlement, the consequences, and a button that states what it is about
 * to do. Anything needing judgement (damage to assess) or carrying a
 * disagreement (an open dispute) falls into the staged flow, which is the
 * pipeline that was always here, now with the money visible on every step
 * instead of only on the third one.
 *
 * Every decision this file makes lives in `moveOutPlan.ts` and is tested
 * there. This component renders; it does not decide.
 *
 * Replaces both the previous version of this sheet and
 * `features/tenants/components/profile/ExitWorkflowSection.tsx`, which were
 * two divergent implementations of the same flow.
 */

const REASON_LABEL: Record<string, string> = {
  COURSE_COMPLETED: 'Course completed',
  JOB_RELOCATION: 'Job relocation',
  PERSONAL_REASONS: 'Personal reasons',
  MOVING_CLOSER: 'Moving closer to work/college',
  BETTER_HOSTEL: 'Found a better hostel',
  TOO_EXPENSIVE: 'Too expensive',
  POOR_MAINTENANCE: 'Poor maintenance',
  FOOD_QUALITY: 'Food quality',
  ROOMMATE_ISSUES: 'Roommate issues',
  SAFETY_CONCERNS: 'Safety concerns',
  RULES_TOO_STRICT: 'Rules too strict',
  OTHER: 'Other',
};

/**
 * Owner-shaped reasons first.
 *
 * The old list opened on "Personal reasons" and offered only tenant motives
 * ("Too expensive", "Roommate issues"), so an owner recording a routine
 * end-of-course exit had to attribute a grievance to the tenant. Most records
 * ended up saying "Personal reasons" regardless of truth, which made
 * `/move-out/analytics` worse than useless.
 */
const OWNER_REASONS = ['COURSE_COMPLETED', 'JOB_RELOCATION', 'MOVING_CLOSER', 'PERSONAL_REASONS', 'OTHER'];
const OTHER_REASONS = Object.keys(REASON_LABEL).filter((r) => !OWNER_REASONS.includes(r));

const labelStyle = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const inputStyle =
  'mt-1.5 w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';
const areaStyle =
  'mt-1.5 min-h-[56px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none';

const rupees = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const todayValue = () => new Date().toISOString().slice(0, 10);
const prettyDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  // The server prefixes validation failures with "VALIDATION:", which means
  // something to the codebase and nothing to the owner reading it.
  return humaniseServerError(data?.error?.message, fallback);
}

interface MoveOutRequest {
  id: string;
  tenant_id: string;
  status: string;
  planned_exit_date: string;
  reason: string;
  reason_text: string | null;
  settlement_preview: SettlementPreview | null;
  disputes: { id: string; status: string }[];
}

export function MoveOutSheet({ open, onClose, tenantId, hostelId, tenantName, roomNo, tenantStatus }: MoveOutSheetProps) {
  const queryClient = useQueryClient();

  const [exitDate, setExitDate] = useState(todayValue());
  const [reason, setReason] = useState('COURSE_COMPLETED');
  const [reasonText, setReasonText] = useState('');
  const [showAllReasons, setShowAllReasons] = useState(false);

  const [suspectsDamage, setSuspectsDamage] = useState(false);
  const [duesDisposition, setDuesDisposition] = useState<DuesDisposition>('RECOVERABLE');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  // COLLECT only: what the owner says they actually took, in rupees. Free
  // text so it can start blank — blank means "the full outstanding balance,"
  // not zero. `paymentMode`/`paymentReference` above double as how it arrived:
  // the backend's `/complete` route takes one payment method for the whole
  // completion, so there is no separate picker for this.
  const [collectedAmount, setCollectedAmount] = useState('');

  // Full-lane only.
  const [roomCondition, setRoomCondition] = useState<'GOOD' | 'FAIR' | 'POOR'>('GOOD');
  const [cleaningStatus, setCleaningStatus] = useState<'CLEAN' | 'NEEDS_CLEANING'>('CLEAN');
  const [damagesAmount, setDamagesAmount] = useState('0');
  const [cleaningFee, setCleaningFee] = useState('0');
  const [missingItemsFee, setMissingItemsFee] = useState('0');
  const [otherDeductions, setOtherDeductions] = useState('0');
  const [deductionNotes, setDeductionNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setExitDate(todayValue());
    setReason('COURSE_COMPLETED');
    setReasonText('');
    setShowAllReasons(false);
    setSuspectsDamage(false);
    setDuesDisposition('RECOVERABLE');
    setPaymentMode('Cash');
    setPaymentReference('');
    setCollectedAmount('');
    setRoomCondition('GOOD');
    setCleaningStatus('CLEAN');
    setDamagesAmount('0');
    setCleaningFee('0');
    setMissingItemsFee('0');
    setOtherDeductions('0');
    setDeductionNotes('');
  }, [open]);

  const listQuery = useQuery({
    queryKey: queryKeys.tenants.moveOut(hostelId, tenantId),
    queryFn: () =>
      moveOutService.listRequests(hostelId, { limit: 50 }) as Promise<{
        requests: Array<{ id: string; tenant_id: string; status: string }>;
      }>,
    enabled: open,
    staleTime: 15_000,
  });

  const { active, lastCompleted } = useMemo(
    () => resolveActiveRequest(listQuery.data?.requests, tenantId),
    [listQuery.data, tenantId],
  );
  const detailId = active?.id ?? lastCompleted?.id;

  const detailQuery = useQuery({
    queryKey: ['owner', 'move-out', 'detail', detailId],
    queryFn: () => moveOutService.getRequest(detailId!) as Promise<MoveOutRequest>,
    enabled: Boolean(detailId),
    staleTime: 10_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tenants.moveOut(hostelId, tenantId) });
    queryClient.invalidateQueries({ queryKey: ['owner', 'move-out'] });
    queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
    queryClient.invalidateQueries({ queryKey: ['owner', 'tenants'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
  };

  const request = detailQuery.data;
  const status = active ? canonicalStatus(active.status) : null;
  const preview = request?.settlement_preview ?? null;
  const hasOpenDispute = (request?.disputes ?? []).some(
    (d) => d.status !== 'RESOLVED' && d.status !== 'REJECTED',
  );

  const lane = decideLane({ preview, hasOpenDispute, suspectsDamage });
  const summary = summariseSettlement(preview);
  const outstandingDues = Number(preview?.total_dues ?? 0);
  const exitIsFuture = new Date(exitDate) > new Date(todayValue());

  // Blank means "the full outstanding balance" — never zero. Capped so a
  // typo (or a stale preview) can't be shown back as a promise the server
  // will refuse anyway.
  const collectedAmountNumber =
    duesDisposition === 'COLLECT'
      ? Math.min(collectedAmount.trim() ? Number(collectedAmount) || 0 : outstandingDues, outstandingDues)
      : undefined;

  const consequences = buildConsequences({
    tenantName,
    roomNo,
    summary,
    outstandingDues,
    duesDisposition,
    collectedAmount: collectedAmountNumber,
    exitDateLabel: prettyDate(exitDate),
    exitIsFuture,
  });

  const quickExitMutation = useMutation({
    mutationFn: () =>
      moveOutService.quickExit({
        hostelId,
        tenantId,
        reason,
        reasonText: reasonText.trim() || undefined,
        plannedExitDate: exitDate,
        physicalExitDate: exitDate,
        paymentMethod: summary.amount > 0 ? paymentMode.toUpperCase().replace(' ', '_') : undefined,
        paymentReference: paymentReference.trim() || undefined,
        duesDisposition,
        expectedNet: Number(preview?.net_settlement_amount ?? 0),
        expectedDirection: summary.direction,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      moveOutService.submitRequest({
        hostelId,
        tenantId,
        reason,
        reasonText: reasonText.trim() || undefined,
        plannedExitDate: exitDate,
      }),
    onSuccess: invalidate,
  });

  const inspectMutation = useMutation({
    mutationFn: () =>
      moveOutService.inspect(active!.id, {
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

  const settleMutation = useMutation({
    mutationFn: () => moveOutService.settle(active!.id, {}),
    onSuccess: invalidate,
  });

  const vacateMutation = useMutation({
    mutationFn: () => moveOutService.vacate(active!.id, { physicalExitDate: exitDate }),
    onSuccess: invalidate,
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      moveOutService.complete(active!.id, {
        paymentMethod: paymentMode.toUpperCase().replace(' ', '_'),
        paymentReference: paymentReference.trim() || undefined,
        duesDisposition,
        // Omitted (not 0) when the field was left blank, so the server
        // settles the full outstanding balance rather than being told "₹0".
        collectedAmount: duesDisposition === 'COLLECT' && collectedAmount.trim() ? Number(collectedAmount) : undefined,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => moveOutService.reject(active!.id, { reason: 'Owner cancelled the exit' }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const isLoading = listQuery.isLoading || (Boolean(detailId) && detailQuery.isLoading);
  const busy =
    quickExitMutation.isPending ||
    submitMutation.isPending ||
    inspectMutation.isPending ||
    settleMutation.isPending ||
    vacateMutation.isPending ||
    completeMutation.isPending ||
    rejectMutation.isPending;

  const activeError =
    quickExitMutation.error ??
    submitMutation.error ??
    inspectMutation.error ??
    settleMutation.error ??
    vacateMutation.error ??
    completeMutation.error ??
    rejectMutation.error;

  /* A completed exit is a receipt, not a workflow. */
  const showReceipt = !active && Boolean(lastCompleted);

  /*
   * Can an exit be started at all? Previously never asked here: the sheet
   * rendered the full form for any tenancy and let the server refuse on
   * submit, so an owner filled in a date and a reason for a cancelled tenant
   * and got back the server's internal validation string.
   */
  const blocked = moveOutBlock({ tenantStatus, activeRequest: active });

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={`Move out · ${tenantName}`}>
      <div className="flex flex-col gap-4 pb-2">
        {blocked && (
          <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
            <p className="font-display text-[13px] font-extrabold text-foreground">{blocked.reason}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{blocked.detail}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-lg bg-card px-3 py-1.5 font-display text-[11.5px] font-bold text-foreground"
            >
              Close
            </button>
          </div>
        )}

        {!blocked && activeError && (
          <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
            {getErrorMessage(activeError, 'Something went wrong. Nothing was changed.')}
          </p>
        )}

        {!blocked && isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        )}

        {!blocked && !isLoading && showReceipt && <Receipt requestId={lastCompleted!.id} />}

        {!blocked && !isLoading && !showReceipt && (
          <>
            {/* The money, on every screen — not just the third one. */}
            <SettlementStrip
              preview={preview}
              summary={summary}
              pending={!active && !preview}
            />

            {active && (
              <div className="flex items-center gap-2 text-[11.5px] font-semibold text-muted-foreground">
                <span className="rounded-md bg-secondary px-1.5 py-0.5 tabular-nums">
                  Step {exitProgress(active.status).step} of {exitProgress(active.status).total}
                </span>
                <span>{exitProgress(active.status).label}</span>
              </div>
            )}

            {hasOpenDispute && (
              <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-[12px] font-semibold text-warning">
                <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
                An open dispute has to be resolved before this exit can close.
              </p>
            )}

            {/* ── FAST LANE: no request yet, nothing to judge ── */}
            {!active && lane.lane === 'FAST' && (
              <>
                <ExitBasics
                  exitDate={exitDate}
                  setExitDate={setExitDate}
                  reason={reason}
                  setReason={setReason}
                  reasonText={reasonText}
                  setReasonText={setReasonText}
                  showAllReasons={showAllReasons}
                  setShowAllReasons={setShowAllReasons}
                />

                {summary.amount > 0 && (
                  <PaymentModeRow
                    label={summary.ownerPays ? 'How are you refunding them?' : 'How was this settled?'}
                    paymentMode={paymentMode}
                    setPaymentMode={setPaymentMode}
                    paymentReference={paymentReference}
                    setPaymentReference={setPaymentReference}
                  />
                )}

                {outstandingDues > 0.01 && (
                  <DuesChoice
                    outstandingDues={outstandingDues}
                    duesDisposition={duesDisposition}
                    setDuesDisposition={setDuesDisposition}
                  />
                )}

                <ConsequenceList lines={consequences} />

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => quickExitMutation.mutate()}
                  className="rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {quickExitMutation.isPending
                    ? 'Closing…'
                    : completionLabel(summary, duesDisposition, outstandingDues)}
                </button>

                <button
                  type="button"
                  onClick={() => setSuspectsDamage(true)}
                  className="text-center text-[12.5px] font-semibold text-muted-foreground underline underline-offset-2"
                >
                  Room needs checking, or there are charges to add
                </button>
              </>
            )}

            {/* ── FULL LANE, entry: create the request, then inspect ── */}
            {!active && lane.lane === 'FULL' && (
              <>
                <LaneReasons blockers={lane.blockers} />
                <ExitBasics
                  exitDate={exitDate}
                  setExitDate={setExitDate}
                  reason={reason}
                  setReason={setReason}
                  reasonText={reasonText}
                  setReasonText={setReasonText}
                  showAllReasons={showAllReasons}
                  setShowAllReasons={setShowAllReasons}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submitMutation.mutate()}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {submitMutation.isPending ? 'Starting…' : 'Start exit & check the room'}
                  <ArrowRight className="h-4 w-4" />
                </button>
                {suspectsDamage && (
                  <button
                    type="button"
                    onClick={() => setSuspectsDamage(false)}
                    className="text-center text-[12.5px] font-semibold text-muted-foreground underline underline-offset-2"
                  >
                    Nothing to charge after all — close it in one step
                  </button>
                )}
              </>
            )}

            {/* ── FULL LANE, staged ── */}
            {active && status === 'REQUESTED' && !hasOpenDispute && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={labelStyle}>Room condition</span>
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
                  <MoneyField label="Damages" value={damagesAmount} onChange={setDamagesAmount} />
                  <MoneyField label="Cleaning fee" value={cleaningFee} onChange={setCleaningFee} />
                  <MoneyField label="Missing items" value={missingItemsFee} onChange={setMissingItemsFee} />
                  <MoneyField label="Other" value={otherDeductions} onChange={setOtherDeductions} />
                </div>
                <RunningDeductions
                  values={[damagesAmount, cleaningFee, missingItemsFee, otherDeductions]}
                  depositHeld={Number(preview?.security_deposit_amount ?? 0)}
                />
                <label className="block">
                  <span className={labelStyle}>Notes (optional)</span>
                  <textarea value={deductionNotes} onChange={(e) => setDeductionNotes(e.target.value)} className={areaStyle} />
                </label>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => rejectMutation.mutate()}
                    className="flex-1 rounded-xl border border-destructive/25 py-3.5 font-display text-sm font-bold text-destructive disabled:opacity-50"
                  >
                    Cancel exit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => inspectMutation.mutate()}
                    className="flex-1 rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                  >
                    {inspectMutation.isPending ? 'Saving…' : 'Save & see settlement'}
                  </button>
                </div>
              </>
            )}

            {active && status === 'SETTLEMENT_PENDING' && !hasOpenDispute && (
              <>
                <ConsequenceList lines={consequences} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => settleMutation.mutate()}
                  className="rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {settleMutation.isPending ? 'Confirming…' : 'Confirm these figures'}
                </button>
              </>
            )}

            {active && status === 'SETTLEMENT_APPROVED' && !hasOpenDispute && (
              <>
                <label className="block">
                  <span className={labelStyle}>Date they actually left</span>
                  <input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} className={inputStyle} />
                </label>
                <ConsequenceList lines={consequences.slice(0, 2)} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => vacateMutation.mutate()}
                  className="rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {vacateMutation.isPending ? 'Releasing…' : 'Release the bed'}
                </button>
              </>
            )}

            {active && (status === 'PHYSICALLY_VACATED' || status === 'SETTLEMENT_PENDING_PAYMENT') && !hasOpenDispute && (
              <>
                {outstandingDues > 0.01 && (
                  <DuesChoice
                    outstandingDues={outstandingDues}
                    duesDisposition={duesDisposition}
                    setDuesDisposition={setDuesDisposition}
                    allowCollect
                    collectedAmount={collectedAmount}
                    setCollectedAmount={setCollectedAmount}
                  />
                )}
                {/* The `/complete` route takes one payment method for the whole
                    completion — this answers both "how did the dues arrive"
                    (COLLECT) and "how was the deposit settled" (a refund, or
                    the tenant's payout kept on account). */}
                {(summary.amount > 0 || duesDisposition === 'COLLECT') && (
                  <PaymentModeRow
                    label={
                      summary.ownerPays
                        ? 'How are you refunding them?'
                        : duesDisposition === 'COLLECT'
                          ? 'How did they pay?'
                          : 'How was this settled?'
                    }
                    paymentMode={paymentMode}
                    setPaymentMode={setPaymentMode}
                    paymentReference={paymentReference}
                    setPaymentReference={setPaymentReference}
                  />
                )}
                <ConsequenceList lines={consequences} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => completeMutation.mutate()}
                  className="rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {completeMutation.isPending
                    ? 'Closing…'
                    : completionLabel(summary, duesDisposition, outstandingDues, collectedAmountNumber)}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

/* ── pieces ───────────────────────────────────────────────── */

function SettlementStrip({
  preview,
  summary,
  pending,
}: {
  preview: SettlementPreview | null;
  summary: ReturnType<typeof summariseSettlement>;
  pending: boolean;
}) {
  if (pending) {
    return (
      <div className="rounded-2xl border border-border bg-secondary/25 p-3.5 text-[12.5px] text-muted-foreground">
        The final settlement is worked out once the exit starts.
      </div>
    );
  }

  const deposit = Number(preview?.security_deposit_amount ?? 0);
  const advance = Number(preview?.advance_balance ?? 0);
  const dues = Number(preview?.total_dues ?? 0);
  const deductions = Number(preview?.total_deductions ?? 0);

  return (
    <div className="rounded-2xl border border-border bg-secondary/25 p-3.5">
      <div className="flex flex-col gap-1.5">
        <Row label="Deposit held" value={rupees(deposit)} muted={deposit === 0} />
        {advance > 0 && <Row label="Advance balance" value={rupees(advance)} />}
        <Row label="Unpaid rent & fees" value={rupees(dues)} muted={dues === 0} />
        {deductions > 0 && <Row label="Deductions" value={`− ${rupees(deductions)}`} />}
      </div>
      <div className="mt-2.5 flex items-baseline justify-between border-t border-border pt-2.5">
        <span className="font-display text-[13px] font-bold text-foreground">{summary.headline}</span>
        <span className="font-display text-[17px] font-extrabold tabular-nums text-primary">
          {summary.amount > 0 ? rupees(summary.amount) : '₹0'}
        </span>
      </div>
      {deposit === 0 && dues > 0 && (
        // An unexplained ₹0 next to a live figure reads as a bug and costs
        // more trust than the number is worth.
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          No deposit is on record for this tenant, so there is nothing to set the unpaid rent against.
        </p>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold tabular-nums ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function ExitBasics(props: {
  exitDate: string;
  setExitDate: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  reasonText: string;
  setReasonText: (v: string) => void;
  showAllReasons: boolean;
  setShowAllReasons: (v: boolean) => void;
}) {
  return (
    <>
      <label className="block">
        <span className={labelStyle}>Date they leave (or left)</span>
        <input type="date" value={props.exitDate} onChange={(e) => props.setExitDate(e.target.value)} className={inputStyle} />
      </label>
      <label className="block">
        <span className={labelStyle}>Reason</span>
        <select value={props.reason} onChange={(e) => props.setReason(e.target.value)} className={inputStyle}>
          {OWNER_REASONS.map((r) => (
            <option key={r} value={r}>{REASON_LABEL[r]}</option>
          ))}
          {props.showAllReasons &&
            OTHER_REASONS.map((r) => (
              <option key={r} value={r}>{REASON_LABEL[r]}</option>
            ))}
        </select>
      </label>
      {!props.showAllReasons && (
        <button
          type="button"
          onClick={() => props.setShowAllReasons(true)}
          className="-mt-2 flex items-center gap-1 self-start text-[12px] font-semibold text-muted-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          They told you why they’re leaving
        </button>
      )}
      <label className="block">
        <span className={labelStyle}>Notes (optional)</span>
        <textarea value={props.reasonText} onChange={(e) => props.setReasonText(e.target.value)} className={areaStyle} />
      </label>
    </>
  );
}

function PaymentModeRow(props: {
  label: string;
  paymentMode: PaymentMode;
  setPaymentMode: (m: PaymentMode) => void;
  paymentReference: string;
  setPaymentReference: (v: string) => void;
}) {
  return (
    <div>
      <span className={labelStyle}>{props.label}</span>
      <div className="mt-1.5 flex gap-2">
        {PAYMENT_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => props.setPaymentMode(m)}
            className={`flex-1 rounded-xl border-[1.5px] py-2.5 font-display text-[12.5px] font-bold ${
              props.paymentMode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <input
        value={props.paymentReference}
        onChange={(e) => props.setPaymentReference(e.target.value)}
        placeholder="Reference (optional)"
        className={inputStyle}
      />
    </div>
  );
}

/**
 * The fork that used to happen silently.
 *
 * Completing a move-out waived every outstanding obligation with no mention
 * of it, behind a button that said "Confirm Refund & Complete". The owner is
 * now asked, and the default keeps their money.
 *
 * `allowCollect` gates the third option (COLLECT): only the staged
 * settlement screen offers it, because `/move-out/quick-exit` — the fast
 * lane's endpoint — doesn't accept it and would silently downgrade it to
 * RECOVERABLE, which is worse than not offering it at all.
 */
function DuesChoice({
  outstandingDues,
  duesDisposition,
  setDuesDisposition,
  allowCollect,
  collectedAmount,
  setCollectedAmount,
}: {
  outstandingDues: number;
  duesDisposition: DuesDisposition;
  setDuesDisposition: (d: DuesDisposition) => void;
  allowCollect?: boolean;
  collectedAmount?: string;
  setCollectedAmount?: (v: string) => void;
}) {
  const options: Array<{ value: DuesDisposition; title: string; detail: string }> = [
    {
      value: 'RECOVERABLE',
      title: 'Keep it on their account',
      detail: 'The debt stays on the books. Nothing chases them for it.',
    },
  ];
  if (allowCollect) {
    options.push({
      value: 'COLLECT',
      title: 'They paid — record it now',
      detail: `Records ${rupees(outstandingDues)} as a real payment: ledger, receipt and their balance all update.`,
    });
  }
  options.push({
    value: 'WAIVE',
    title: 'Write it off',
    detail: 'The money is gone. This cannot be undone.',
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <p className="font-display text-[13px] font-bold text-foreground">
        {rupees(outstandingDues)} is still unpaid
      </p>
      <div className="mt-2.5 flex flex-col gap-2">
        {options.map(({ value, title, detail }) => (
          <button
            key={value}
            type="button"
            onClick={() => setDuesDisposition(value)}
            className={`rounded-xl border-[1.5px] px-3 py-2.5 text-left ${
              duesDisposition === value ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <span className="block font-display text-[12.5px] font-bold text-foreground">{title}</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">{detail}</span>
          </button>
        ))}
      </div>
      {allowCollect && duesDisposition === 'COLLECT' && setCollectedAmount && (
        <label className="mt-2.5 block">
          <span className={labelStyle}>Amount collected (optional)</span>
          <input
            value={collectedAmount ?? ''}
            onChange={(e) => setCollectedAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={`Full ${rupees(outstandingDues)} if left blank`}
            inputMode="numeric"
            className={inputStyle}
          />
        </label>
      )}
    </div>
  );
}

function ConsequenceList({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <p className={labelStyle}>What happens next</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {lines.map((line) => (
          <li key={line} className="flex gap-2 text-[12.5px] leading-snug text-foreground">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LaneReasons({ blockers }: { blockers: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/25 p-3 text-[12px] leading-snug text-muted-foreground">
      {blockers.map((b) => (
        <p key={b}>{b}</p>
      ))}
    </div>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className={labelStyle}>{label} (₹)</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        inputMode="numeric"
        className={inputStyle}
      />
    </label>
  );
}

/** Deductions add up against something — show what, while they're being typed. */
function RunningDeductions({ values, depositHeld }: { values: string[]; depositHeld: number }) {
  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);
  if (total <= 0) return null;
  const exceeds = total > depositHeld;
  return (
    <p className={`text-[12px] font-semibold ${exceeds ? 'text-warning' : 'text-muted-foreground'}`}>
      {rupees(total)} in charges against {rupees(depositHeld)} of deposit
      {exceeds ? ' — the excess will be owed by the tenant.' : '.'}
    </p>
  );
}

function Receipt({ requestId }: { requestId: string }) {
  const { data } = useQuery({
    queryKey: ['owner', 'move-out', 'detail', requestId],
    queryFn: () => moveOutService.getRequest(requestId) as Promise<any>,
    staleTime: 60_000,
  });

  const settlement = data?.settlement;
  const inspection = data?.inspection;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
          <Check className="h-5 w-5 text-success" strokeWidth={3} />
        </span>
        <p className="font-display text-base font-extrabold text-foreground">Move-out complete</p>
      </div>

      {/* The owner has to be able to re-read what they settled. The previous
          sheet showed a tick and nothing else, so this was unrecoverable. */}
      <div className="rounded-2xl border border-border bg-card p-3.5">
        <p className={labelStyle}>Settlement</p>
        <div className="mt-2 flex flex-col gap-1.5">
          <Row label="Left on" value={data?.physical_exit_date ? prettyDate(data.physical_exit_date) : '—'} />
          <Row label="Closed on" value={data?.completed_at ? prettyDate(data.completed_at) : '—'} />
          {settlement && (
            <>
              <Row
                label="Outcome"
                value={
                  settlement.settlement_direction === 'OWNER_OWES_TENANT'
                    ? `Refunded ${rupees(settlement.confirmed_settlement_amount ?? 0)}`
                    : settlement.settlement_direction === 'TENANT_OWES_OWNER'
                      ? `Settled ${rupees(settlement.confirmed_settlement_amount ?? 0)}`
                      : 'Nothing owed'
                }
              />
              <Row label="Paid by" value={settlement.payment_method || '—'} />
              {settlement.payment_reference && <Row label="Reference" value={settlement.payment_reference} />}
            </>
          )}
          {inspection && Number(inspection.total_deductions) > 0 && (
            <Row label="Deductions" value={rupees(inspection.total_deductions)} />
          )}
        </div>
      </div>
    </div>
  );
}
