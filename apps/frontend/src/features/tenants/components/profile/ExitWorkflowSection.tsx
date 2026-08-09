import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { 
  CalendarDays, 
  DoorOpen, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  BadgeIndianRupee, 
  Settings, 
  Undo,
  Plus
} from 'lucide-react';
import { moveOutService } from '@features/move-out/api';
import { MoveOutStepper } from '@features/tenants/components/moveout/MoveOutStepper';
import { queryKeys } from '@lib/queryKeys';
import { canonicalMoveOutStatus } from '@/shared/types/moveout';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

interface Props {
  hostelId: string;
  tenantId: string;
  status: string;
}

export function ExitWorkflowSection({ hostelId, tenantId, status }: Props) {
  const { data: requests, refetch } = useQuery({
    queryKey: queryKeys.tenants.moveOut(hostelId, tenantId),
    queryFn: () => moveOutService.listRequests(hostelId, {}),
    enabled: status === 'ACTIVE' || status === 'MOVE_OUT_REQUESTED' || status === 'FORMER_TENANT' || status === 'LEFT',
  });

  const list = Array.isArray(requests) ? requests : (requests as Record<string, unknown>)?.requests ?? [];
  const active = (list as Record<string, unknown>[]).find(
    (r) => String(r.tenant_id) === tenantId && !['COMPLETED', 'REJECTED'].includes(canonicalMoveOutStatus(r.status))
  );

  const { data: activeDetail, refetch: refetchDetail } = useQuery({
    queryKey: ['move-out', 'detail', active?.id],
    queryFn: () => moveOutService.getRequest(String(active.id)),
    enabled: !!active?.id,
  });

  // Owner initiation state
  const [showInitForm, setShowInitForm] = useState(false);
  const [initDate, setInitDate] = useState(new Date().toISOString().slice(0, 10));
  const [initReason, setInitReason] = useState('PERSONAL_REASONS');
  const [initNotes, setInitNotes] = useState('');

  // Workflow control state
  const [showInspectForm, setShowInspectForm] = useState(false);
  const [roomCondition, setRoomCondition] = useState('GOOD');
  const [cleaningStatus, setCleaningStatus] = useState('CLEAN');
  const [damagesAmount, setDamagesAmount] = useState('0');
  const [cleaningFee, setCleaningFee] = useState('0');
  const [missingItemsFee, setMissingItemsFee] = useState('0');
  const [otherDeductions, setOtherDeductions] = useState('0');
  const [deductionNotes, setDeductionNotes] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');

  const [settlementDirection, setSettlementDirection] = useState('SETTLED');
  const [settlementAmount, setSettlementAmount] = useState('0');

  const [physicalExitDate, setPhysicalExitDate] = useState(new Date().toISOString().slice(0, 10));

  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Sync settlement default values when active detail changes
  useEffect(() => {
    if (activeDetail?.settlement) {
      const dir = activeDetail.settlement.settlement_direction ?? 'SETTLED';
      setSettlementDirection(dir);
      setSettlementAmount(String(Math.abs(Number(activeDetail.settlement.net_settlement_amount || 0))));
    }
    if (activeDetail?.planned_exit_date) {
      setPhysicalExitDate(String(activeDetail.planned_exit_date).slice(0, 10));
    }
  }, [activeDetail]);

  const initMutation = useMutation({
    mutationFn: () =>
      moveOutService.submitRequest({
        hostelId,
        tenantId,
        plannedExitDate: initDate,
        reason: initReason,
        reasonText: initNotes,
      }),
    onSuccess: () => {
      toast.success('Move-out request initiated successfully');
      setShowInitForm(false);
      setInitNotes('');
      refetch();
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error?.message ?? 'Failed to initiate move-out');
    },
  });

  const inspectMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      moveOutService.inspect(String(active?.id), payload),
    onSuccess: () => {
      toast.success('Room inspection recorded');
      setShowInspectForm(false);
      refetchDetail();
      refetch();
    },
    onError: () => toast.error('Could not save inspection'),
  });

  const settleMutation = useMutation({
    mutationFn: () =>
      moveOutService.settle(String(active?.id), {
        settlementDirection,
        confirmedSettlementAmount: Number(settlementAmount) || 0,
      }),
    onSuccess: () => {
      toast.success('Settlement approved');
      refetchDetail();
      refetch();
    },
    onError: () => toast.error('Could not approve settlement'),
  });

  const vacateMutation = useMutation({
    mutationFn: () =>
      moveOutService.vacate(String(active?.id), {
        physicalExitDate,
      }),
    onSuccess: () => {
      toast.success('Tenant marked as vacated');
      refetchDetail();
      refetch();
    },
    onError: () => toast.error('Could not record vacate action'),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      moveOutService.complete(String(active?.id), {
        paymentMethod,
        paymentReference,
        paymentNotes,
      }),
    onSuccess: () => {
      toast.success('Move-out completed');
      refetchDetail();
      refetch();
    },
    onError: () => toast.error('Could not complete move-out'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => moveOutService.reject(String(active?.id)),
    onSuccess: () => {
      toast.success('Move-out request rejected');
      refetchDetail();
      refetch();
    },
    onError: () => toast.error('Could not reject request'),
  });

  if (status === 'FORMER_TENANT' || status === 'LEFT') {
    if (!active) {
      return <p className="text-sm text-muted-foreground">This tenant has completed their exit.</p>;
    }
  }

  // --- Render Initiation Form if no active request ---
  if (!active) {
    return (
      <div className="space-y-4">
        {!showInitForm ? (
          <div className="p-4 rounded-xl border border-border bg-card text-sm space-y-3">
            <p className="text-muted-foreground">No active move-out request for this tenant.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowInitForm(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#243A72] text-white font-semibold text-sm hover:bg-[#1b2d5c] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Initiate Move Out
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-border bg-card space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-foreground">Initiate Move Out</h3>
              <button 
                type="button" 
                onClick={() => setShowInitForm(false)} 
                className="text-xs text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block">
                Planned Exit Date
                <input
                  type="date"
                  value={initDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setInitDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>

              <label className="block">
                Reason
                <select
                  value={initReason}
                  onChange={(e) => setInitReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="PERSONAL_REASONS">Personal reasons / Going home</option>
                  <option value="JOB_RELOCATION">Job relocation</option>
                  <option value="COURSE_COMPLETED">Course completed</option>
                  <option value="TOO_EXPENSIVE">Too expensive</option>
                  <option value="POOR_MAINTENANCE">Maintenance concerns</option>
                  <option value="FOOD_QUALITY">Food quality</option>
                  <option value="ROOMMATE_ISSUES">Roommate issues</option>
                  <option value="BETTER_HOSTEL">Moving to another hostel</option>
                  <option value="SAFETY_CONCERNS">Safety concerns</option>
                  <option value="MOVING_CLOSER">Moving closer to college/work</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>

              <label className="block">
                Reason Notes (optional)
                <textarea
                  rows={2}
                  value={initNotes}
                  onChange={(e) => setInitNotes(e.target.value)}
                  placeholder="Additional context or notes..."
                  className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>

            <button
              type="button"
              disabled={initMutation.isPending}
              onClick={() => initMutation.mutate()}
              className="w-full py-2.5 rounded-xl bg-[#243A72] text-white font-semibold text-sm hover:bg-[#1b2d5c] transition-colors disabled:opacity-50"
            >
              {initMutation.isPending ? 'Initiating...' : 'Submit Request'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // --- Render Active Request Workflow Controls ---
  const currentStatus = canonicalMoveOutStatus(active.status);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-border bg-secondary/20">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">
          Exit Stepper
        </h3>
        <MoveOutStepper request={active} hostelId={hostelId} />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground">
          {currentStatus === 'COMPLETED' ? 'Settlement & Closeout Summary' : 'Workflow Action Controls'}
        </h3>

        {/* 0. Completed State: Show details */}
        {currentStatus === 'COMPLETED' && (
          <div className="p-5 rounded-2xl border border-emerald-100 bg-emerald-50/30 space-y-4 shadow-sm text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 animate-bounce" />
              <span className="text-sm font-bold text-emerald-950">Move-out Completed Successfully</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Timing info */}
              <div className="p-3.5 rounded-xl bg-white border border-emerald-100/65 space-y-2">
                <p className="font-bold text-emerald-950 uppercase tracking-wider text-[10px]">Move-out Timeline</p>
                <div className="space-y-1.5 text-slate-700">
                  <div className="flex justify-between">
                    <span>Planned Exit:</span>
                    <span className="font-semibold text-slate-900">
                      {activeDetail?.planned_exit_date ? new Date(activeDetail.planned_exit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Physical Exit:</span>
                    <span className="font-semibold text-slate-900">
                      {activeDetail?.physical_exit_date ? new Date(activeDetail.physical_exit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Completed On:</span>
                    <span className="font-semibold text-slate-900">
                      {activeDetail?.completed_at ? new Date(activeDetail.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Settlement info */}
              {activeDetail?.settlement && (
                <div className="p-3.5 rounded-xl bg-white border border-emerald-100/65 space-y-2">
                  <p className="font-bold text-emerald-950 uppercase tracking-wider text-[10px]">Settlement & Payment</p>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span>Direction:</span>
                      <span className="font-semibold text-slate-900">
                        {activeDetail.settlement.settlement_direction === 'OWNER_OWES_TENANT' 
                          ? 'Refund to Tenant' 
                          : activeDetail.settlement.settlement_direction === 'TENANT_OWES_OWNER' 
                            ? 'Paid by Tenant' 
                            : 'No payment needed'}
                      </span>
                    </div>
                    {activeDetail.settlement.settlement_direction !== 'SETTLED' && (
                      <div className="flex justify-between">
                        <span>Amount:</span>
                        <span className="font-bold text-emerald-600">
                          ₹{Number(activeDetail.settlement.confirmed_settlement_amount ?? 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Payment Method:</span>
                      <span className="font-semibold text-slate-900">{activeDetail.settlement.payment_method || '—'}</span>
                    </div>
                    {activeDetail.settlement.payment_reference && (
                      <div className="flex justify-between">
                        <span>Reference:</span>
                        <span className="font-semibold text-slate-900 font-mono">{activeDetail.settlement.payment_reference}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Inspection summary if present */}
            {activeDetail?.inspection && (
              <div className="p-4 rounded-xl bg-white border border-emerald-100/65 space-y-3">
                <p className="font-bold text-emerald-950 uppercase tracking-wider text-[10px]">Room Inspection Report</p>
                <div className="grid grid-cols-2 gap-3 text-slate-700">
                  <div>
                    <span className="block text-slate-500 text-[10px]">Room Condition</span>
                    <span className="font-semibold text-slate-900">{activeDetail.inspection.room_condition}</span>
                  </div>
                  <div>
                    <span className="block text-slate-500 text-[10px]">Cleaning Status</span>
                    <span className="font-semibold text-slate-900">{activeDetail.inspection.cleaning_status}</span>
                  </div>
                </div>

                {/* Deductions if any */}
                {(Number(activeDetail.inspection.damages_amount) > 0 ||
                  Number(activeDetail.inspection.cleaning_fee) > 0 ||
                  Number(activeDetail.inspection.missing_items_fee) > 0 ||
                  Number(activeDetail.inspection.other_deductions) > 0) && (
                  <div className="pt-2 border-t border-slate-100 space-y-1 text-slate-700">
                    <span className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider">Deductions</span>
                    {Number(activeDetail.inspection.damages_amount) > 0 && (
                      <div className="flex justify-between">
                        <span>Damage Charges:</span>
                        <span className="font-semibold text-red-600">₹{Number(activeDetail.inspection.damages_amount).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    {Number(activeDetail.inspection.cleaning_fee) > 0 && (
                      <div className="flex justify-between">
                        <span>Cleaning Fee:</span>
                        <span className="font-semibold text-red-600">₹{Number(activeDetail.inspection.cleaning_fee).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    {Number(activeDetail.inspection.missing_items_fee) > 0 && (
                      <div className="flex justify-between">
                        <span>Missing Items Fee:</span>
                        <span className="font-semibold text-red-600">₹{Number(activeDetail.inspection.missing_items_fee).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    {Number(activeDetail.inspection.other_deductions) > 0 && (
                      <div className="flex justify-between">
                        <span>Other Deductions:</span>
                        <span className="font-semibold text-red-600">₹{Number(activeDetail.inspection.other_deductions).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {activeDetail.inspection.notes && (
                  <div className="pt-2 border-t border-slate-100 text-slate-600">
                    <span className="block text-slate-500 text-[10px]">Inspection Notes</span>
                    <p className="mt-0.5 leading-relaxed">{activeDetail.inspection.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 1. Requested State: Record Inspection */}
        {currentStatus === 'REQUESTED' && (
          <div className="space-y-3">
            {!showInspectForm ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowInspectForm(true)}
                  className="flex-1 py-2.5 rounded-xl bg-[#243A72] text-white font-semibold text-sm hover:bg-[#1b2d5c]"
                >
                  Record Room Inspection
                </button>
                <button
                  type="button"
                  disabled={rejectMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Are you sure you want to reject this request?')) {
                      rejectMutation.mutate();
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-700 font-semibold text-sm hover:bg-red-100"
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                <h4 className="text-xs font-bold text-foreground">Record Room Inspection</h4>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label>
                    Room condition
                    <select
                      value={roomCondition}
                      onChange={(e) => setRoomCondition(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2"
                    >
                      <option value="GOOD">Good</option>
                      <option value="FAIR">Fair</option>
                      <option value="POOR">Poor</option>
                    </select>
                  </label>
                  <label>
                    Cleaning status
                    <select
                      value={cleaningStatus}
                      onChange={(e) => setCleaningStatus(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2"
                    >
                      <option value="CLEAN">Clean</option>
                      <option value="DIRTY">Dirty</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label>
                    Damage charges
                    <input
                      type="number"
                      min="0"
                      value={damagesAmount}
                      onChange={(e) => setDamagesAmount(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2"
                    />
                  </label>
                  <label>
                    Cleaning fee
                    <input
                      type="number"
                      min="0"
                      value={cleaningFee}
                      onChange={(e) => setCleaningFee(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2"
                    />
                  </label>
                  <label>
                    Missing items fee
                    <input
                      type="number"
                      min="0"
                      value={missingItemsFee}
                      onChange={(e) => setMissingItemsFee(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2"
                    />
                  </label>
                  <label>
                    Other deductions
                    <input
                      type="number"
                      min="0"
                      value={otherDeductions}
                      onChange={(e) => setOtherDeductions(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2"
                    />
                  </label>
                </div>

                <input
                  type="text"
                  value={deductionNotes}
                  onChange={(e) => setDeductionNotes(e.target.value)}
                  placeholder="Deduction notes..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                />

                <textarea
                  rows={2}
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                  placeholder="General inspection notes..."
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                />

                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowInspectForm(false)}
                    className="flex-1 rounded-lg border border-border py-2 font-semibold text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={inspectMutation.isPending}
                    onClick={() =>
                      inspectMutation.mutate({
                        roomCondition,
                        cleaningStatus,
                        damagesAmount: Number(damagesAmount) || 0,
                        cleaningFee: Number(cleaningFee) || 0,
                        missingItemsFee: Number(missingItemsFee) || 0,
                        otherDeductions: Number(otherDeductions) || 0,
                        deductionNotes: deductionNotes || null,
                        notes: generalNotes || null,
                      })
                    }
                    className="flex-1 rounded-lg bg-[#243A72] text-white py-2 font-semibold disabled:opacity-50"
                  >
                    {inspectMutation.isPending ? 'Saving...' : 'Submit Inspection'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. Settlement Pending State */}
        {currentStatus === 'SETTLEMENT_PENDING' && (
          <div className="p-4 rounded-xl border border-border bg-card space-y-3">
            <div className="flex items-center gap-2">
              <BadgeIndianRupee className="h-4 w-4 text-[#243A72]" />
              <h4 className="text-sm font-semibold text-foreground">Confirm Final Settlement</h4>
            </div>
            
            <div className="grid gap-2 grid-cols-2 text-xs">
              <label>
                Settlement result
                <select
                  value={settlementDirection}
                  onChange={(e) => setSettlementDirection(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                >
                  <option value="OWNER_OWES_TENANT">Refund to tenant</option>
                  <option value="TENANT_OWES_OWNER">Tenant should pay</option>
                  <option value="SETTLED">No payment needed</option>
                </select>
              </label>
              
              <label>
                Amount (₹)
                <input
                  type="number"
                  min="0"
                  value={settlementAmount}
                  disabled={settlementDirection === 'SETTLED'}
                  onChange={(e) => setSettlementAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-50"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={settleMutation.isPending}
                onClick={() => settleMutation.mutate()}
                className="w-full rounded-xl bg-[#243A72] py-2.5 text-white font-semibold text-sm hover:bg-[#1b2d5c] disabled:opacity-50"
              >
                {settleMutation.isPending ? 'Approving...' : 'Confirm Settlement'}
              </button>
              
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => {
                  if (window.confirm('Are you sure you want to reject this request?')) {
                    rejectMutation.mutate();
                  }
                }}
                className="w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-red-700 font-semibold text-sm hover:bg-red-100 disabled:opacity-50"
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Reject request'}
              </button>
            </div>
          </div>
        )}

        {/* 3. Settlement Approved State: Vacate Bed */}
        {currentStatus === 'SETTLEMENT_APPROVED' && (
          <div className="p-4 rounded-xl border border-border bg-card space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[#243A72]" />
              <h4 className="text-sm font-semibold text-foreground">Release bed & vacate tenant</h4>
            </div>

            <label className="block text-xs">
              Physical exit date
              <input
                type="date"
                value={physicalExitDate}
                onChange={(e) => setPhysicalExitDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <button
              type="button"
              disabled={vacateMutation.isPending || !physicalExitDate}
              onClick={() => vacateMutation.mutate()}
              className="w-full rounded-xl bg-[#243A72] py-2.5 text-white font-semibold text-sm hover:bg-[#1b2d5c] disabled:opacity-50"
            >
              {vacateMutation.isPending ? 'Vacating...' : 'Vacate & release bed'}
            </button>
          </div>
        )}

        {/* 4. Physical Exit State: Record final payment */}
        {['PHYSICALLY_VACATED', 'SETTLEMENT_PENDING_PAYMENT'].includes(currentStatus) && (
          <div className="p-4 rounded-xl border border-border bg-card space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <h4 className="text-sm font-semibold text-foreground">Record Final Payment</h4>
            </div>

            <div className="grid gap-2 grid-cols-2 text-xs">
              <label>
                Method
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                >
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              </label>

              <label>
                Reference
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="Txn/ref no."
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>
            </div>

            <textarea
              rows={2}
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Payment notes..."
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
            />

            <button
              type="button"
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
              className="w-full rounded-xl bg-[#243A72] py-2.5 text-white font-semibold text-sm hover:bg-[#1b2d5c] disabled:opacity-50"
            >
              {completeMutation.isPending ? 'Completing...' : 'Confirm Payment & Complete'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
