import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, DoorOpen, AlertTriangle, CheckCircle2, Clock, CreditCard, ChevronRight, MessageSquare, Star } from 'lucide-react';
import { moveOutService } from '@features/move-out/api';
import { useTenantDashboard } from '@features/tenant-portal/hooks/useTenantDashboard';
import { MoveOutStepper } from '@features/tenants/components/moveout/MoveOutStepper';
import { Link } from 'react-router-dom';
import { canonicalMoveOutStatus } from '@/shared/types/moveout';
import { StayoLoader } from '@shared/ui/brand';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
const GOOGLE_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=ChIJW1hB1g13yzsRscG4r7mVPt4';

const REASONS = [
  { value: 'COURSE_COMPLETED', label: 'Course Completed' },
  { value: 'PERSONAL_REASONS', label: 'Going Home' },
  { value: 'MOVING_CLOSER', label: 'Moving Closer To College' },
  { value: 'BETTER_HOSTEL', label: 'Found Better Hostel' },
  { value: 'TOO_EXPENSIVE', label: 'Found Cheaper Hostel' },
  { value: 'FOOD_QUALITY', label: 'Food Issues' },
  { value: 'POOR_MAINTENANCE', label: 'Facilities Issues' },
  { value: 'ROOMMATE_ISSUES', label: 'Roommate Issues' },
  { value: 'OTHER', label: 'Other' },
];

export function TenantMoveOutPage() {
  const { profile, advance, dues, refetchAll, isLoading: isDashboardLoading } = useTenantDashboard();
  const prof = profile?.profile as Record<string, unknown> | undefined;
  const tenant = profile?.tenant as Record<string, unknown> | undefined;
  
  // Resolve year of study
  const yearOfStudy = tenant?.year_of_study || profile?.year_of_study;
  const is4thYear = yearOfStudy === 4 || yearOfStudy === '4';

  const { data: timeline, isLoading, refetch } = useQuery({
    queryKey: ['tenant', 'move-out', 'timeline'],
    queryFn: () => moveOutService.getTimeline(),
  });

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [dateChoice, setDateChoice] = useState<'TODAY' | 'LATER' | ''>('');
  const [plannedDate, setPlannedDate] = useState('');
  const [reason, setReason] = useState(is4thYear ? 'COURSE_COMPLETED' : '');
  const [reasonText, setReasonText] = useState('');

  // Feedback screen state
  const [ratings, setRatings] = useState<Record<string, number>>({
    ratingFood: 0,
    ratingCleanliness: 0,
    ratingManagement: 0,
    ratingWifi: 0,
    ratingSafety: 0,
  });
  const [experienceText, setExperienceText] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [calculatedOverallRating, setCalculatedOverallRating] = useState(5);
  const [submittedDispute, setSubmittedDispute] = useState<Record<string, unknown> | null>(null);

  const submitMutation = useMutation({
    mutationFn: () =>
      moveOutService.submitRequest({
        plannedExitDate: dateChoice === 'TODAY' 
          ? new Date().toISOString().slice(0, 10) 
          : plannedDate,
        reason,
        reasonText,
      }),
    onSuccess: () => {
      toast.success('Move-out request submitted');
      refetch();
      refetchAll();
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string } } } }) =>
      toast.error(e?.response?.data?.error?.message ?? 'Failed to submit'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => moveOutService.cancelRequest(String(request?.id ?? '')),
    onSuccess: () => {
      toast.success('Move-out request cancelled');
      refetch();
      refetchAll();
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string } } } }) =>
      toast.error(e?.response?.data?.error?.message ?? 'Failed to cancel'),
  });

  const disputeMutation = useMutation({
    mutationFn: (payload: { disputeType: string; description: string; disputedAmount: number }) =>
      moveOutService.dispute(String(request?.id ?? ''), payload),
    onSuccess: (result) => {
      setSubmittedDispute((result ?? null) as Record<string, unknown> | null);
      toast.success('Dispute submitted');
      setShowDisputeForm(false);
      setDisputeDescription('');
      setDisputedAmount('');
      refetch();
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string } } } }) =>
      toast.error(e?.response?.data?.error?.message ?? 'Failed to submit dispute'),
  });

  const feedbackMutation = useMutation({
    mutationFn: (payload: any) => moveOutService.feedback(String(request?.id ?? ''), payload),
    onSuccess: () => {
      toast.success('Thank you for your feedback!');
      setFeedbackSubmitted(true);
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string } } } }) =>
      toast.error(e?.response?.data?.error?.message ?? 'Failed to submit feedback'),
  });

  const timelineData = (timeline ?? {}) as Record<string, unknown>;
  const active = Boolean(timelineData.active);
  const requestFromTimeline = timelineData.request as Record<string, unknown> | undefined;
  const request = requestFromTimeline ?? (active
    ? {
        id: timelineData.request_id,
        status: timelineData.status,
        planned_exit_date: timelineData.planned_exit_date,
      }
    : null);
  const requestStatus = request ? canonicalMoveOutStatus(request.status) : '';
  const settlement = timelineData.settlement as Record<string, unknown> | undefined;
  const disputes = Array.isArray(timelineData.disputes) ? timelineData.disputes as Record<string, unknown>[] : [];
  const activeDispute = disputes.find((d) => ['OPEN', 'UNDER_REVIEW'].includes(String(d.status))) ?? submittedDispute;

  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeType, setDisputeType] = useState('DAMAGE_CHARGE_DISPUTE');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputedAmount, setDisputedAmount] = useState('');

  if (isLoading || isDashboardLoading) {
    return (
      <div className="flex justify-center py-20">
        <StayoLoader size="lg" className="text-[#243A72]" />
      </div>
    );
  }


  const isTenantActive = tenant && String(tenant.status).toUpperCase() === 'ACTIVE';

  if (!active && tenant && !isTenantActive) {
    return (
      <div className="space-y-6 max-w-md mx-auto py-12 px-4 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 mb-2">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Stay Inactive</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your tenancy is currently inactive (status: <strong>{tenant.status ? String(tenant.status).replace('_', ' ') : 'inactive'}</strong>).
          Move-out requests can only be initiated by active tenants. 
          If you believe this is an error, please contact the hostel management.
        </p>
        <Link
          to="/tenant"
          className="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-[#243A72] text-white font-semibold hover:bg-[#1B2D5B] transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // --- Feedback Flow (when status is COMPLETED) ---
  if (active && request && requestStatus === 'COMPLETED') {
    if (feedbackSubmitted) {
      return (
        <div className="space-y-6 max-w-md mx-auto py-10 px-4 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-2">
            <CheckCircle2 className="h-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Stay Completed</h1>
          
          {calculatedOverallRating >= 4 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Thank you for the awesome feedback! We are thrilled you had a great experience staying with us. We would love if you could share your experience on Google.
              </p>
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-[#243A72] text-white font-semibold shadow-lg shadow-blue-500/10 hover:bg-[#1B2D5B] transition-colors"
              >
                Write a Google Review
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Thank you for your feedback! We will use your inputs to improve our services and hostel facilities.
              </p>
            </div>
          )}
          
          <button
            type="button"
            onClick={() => {
              refetch();
              refetchAll();
            }}
            className="w-full py-3 rounded-xl border border-border text-foreground bg-card font-semibold text-sm hover:bg-secondary/20 transition-colors mt-2"
          >
            Finish
          </button>
        </div>
      );
    }

    const handleRatingSelect = (category: string, score: number) => {
      setRatings((prev) => ({ ...prev, [category]: score }));
    };

    const handleFeedbackSubmit = () => {
      const incomplete = Object.values(ratings).some((r) => r === 0);
      if (incomplete) {
        toast.error('Please rate all categories before submitting.');
        return;
      }

      const scores = Object.values(ratings);
      const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      setCalculatedOverallRating(overall);

      feedbackMutation.mutate({
        ratingFood: ratings.ratingFood,
        ratingCleanliness: ratings.ratingCleanliness,
        ratingWifi: ratings.ratingWifi,
        ratingManagement: ratings.ratingManagement,
        ratingSafety: ratings.ratingSafety,
        overallRating: overall,
        experienceText,
      });
    };

    const ratingItems = [
      { key: 'ratingFood', label: 'Food Quality' },
      { key: 'ratingCleanliness', label: 'Room & Cleanliness' },
      { key: 'ratingManagement', label: 'Hostel Staff & Management' },
      { key: 'ratingWifi', label: 'WiFi Speed & Reliability' },
      { key: 'ratingSafety', label: 'Safety & Security' },
    ];

    return (
      <div className="space-y-6 max-w-md mx-auto pb-10">
        <div className="text-center space-y-1 py-4">
          <h1 className="text-2xl font-bold text-foreground">Stay Completed</h1>
          <p className="text-sm text-muted-foreground">Help us improve. Your feedback matters.</p>
        </div>

        <div className="space-y-4">
          {ratingItems.map((item) => (
            <div key={item.key} className="p-4 rounded-xl border border-border bg-card space-y-3">
              <p className="text-sm font-semibold text-foreground">{item.label}</p>
              <div className="flex gap-4">
                {[
                  { score: 1, label: '🙁 Poor' },
                  { score: 3, label: '😐 Average' },
                  { score: 5, label: '🙂 Excellent' },
                ].map((face) => {
                  const selected = ratings[item.key] === face.score;
                  return (
                    <button
                      key={face.score}
                      type="button"
                      onClick={() => handleRatingSelect(item.key, face.score)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center transition-all ${
                        selected
                          ? 'border-[#243A72] bg-[#243A72]/5 text-[#243A72]'
                          : 'border-border bg-background text-muted-foreground hover:bg-secondary/10'
                      }`}
                    >
                      {face.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-foreground">
            Anything you&apos;d like us to know? <span className="text-xs font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={experienceText}
            onChange={(e) => setExperienceText(e.target.value)}
            placeholder="Share details of your stay..."
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-3 text-sm"
          />
        </div>

        <button
          type="button"
          disabled={feedbackMutation.isPending}
          onClick={handleFeedbackSubmit}
          className="w-full py-3.5 rounded-xl bg-[#243A72] text-white font-semibold shadow-lg shadow-blue-500/10 hover:bg-[#1B2D5B] transition-colors"
        >
          {feedbackMutation.isPending ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </div>
    );
  }

  // --- Active Request Flow ---
  if (active && request && typeof request === 'object') {
    const paidDeposit = Number(settlement?.security_deposit_amount ?? advance?.security_deposit_paid ?? 0);
    const extraAdvance = Number(settlement?.advance_balance ?? 0);
    const pendingRent = Number(settlement?.pending_rent_dues ?? dues?.rent_due ?? dues?.total_due ?? 0);
    const lateFees = Number(settlement?.pending_late_fees ?? 0);
    const otherDues = Number(
      settlement?.pending_utility_dues ??
        Math.max(0, Number(dues?.total_due ?? 0) - pendingRent - lateFees)
    );
    const deductions = Number(settlement?.total_deductions ?? settlement?.damages_amount ?? settlement?.damage_charges ?? 0);
    const netAmount = Number(
      settlement?.net_amount ??
        settlement?.net_settlement_amount ??
        paidDeposit + extraAdvance - pendingRent - lateFees - otherDues - deductions
    );
    const direction = String(settlement?.direction ?? settlement?.settlement_direction ?? '');

    const tenantOwesMoney = direction === 'TENANT_OWES_OWNER' || netAmount < 0;

    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold text-foreground">Move-out Details</h1>
        <MoveOutStepper request={request as Record<string, unknown>} hostelId="" />

        {/* Conditional Settlement Required Card */}
        {['SETTLEMENT_PENDING', 'SETTLEMENT_APPROVED', 'SETTLEMENT_PENDING_PAYMENT'].includes(requestStatus) && (
          tenantOwesMoney ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
                <AlertTriangle className="w-5 h-5" />
                <span>Settlement Required</span>
              </div>
              <p className="text-xs text-red-600">
                Your final dues have been calculated. Please review the breakdown below and complete the payment to proceed with your move-out approval.
              </p>
              <Link
                to="/tenant/financials?pay=1"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-red-600 text-white font-bold text-xs hover:bg-red-700 transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                Pay {fmt(Math.abs(netAmount))}
              </Link>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-blue-700 font-bold text-sm">
                <Clock className="w-5 h-5" />
                <span>Refund Processing</span>
              </div>
              <p className="text-xs text-blue-600">
                You are due a refund of {fmt(Math.abs(netAmount))}. The property owner will approve and release this payment to your account.
              </p>
            </div>
          )
        )}

        {(paidDeposit > 0 || extraAdvance > 0 || pendingRent > 0 || lateFees > 0 || otherDues > 0 || settlement) && (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Settlement breakdown</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid security deposit</span>
                <span>{fmt(paidDeposit)}</span>
              </div>
              {extraAdvance > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Future rent credit balance</span>
                  <span>{fmt(extraAdvance)}</span>
                </div>
              )}
              {pendingRent > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pending rent</span>
                  <span className="text-destructive">−{fmt(pendingRent)}</span>
                </div>
              )}
              {lateFees > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Late fees</span>
                  <span className="text-destructive">−{fmt(lateFees)}</span>
                </div>
              )}
              {otherDues > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Maintenance / other dues</span>
                  <span className="text-destructive">−{fmt(otherDues)}</span>
                </div>
              )}
              {deductions > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Inspection deductions</span>
                  <span className="text-destructive">−{fmt(deductions)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-border font-bold">
                <span>{tenantOwesMoney ? 'Amount to pay' : 'Refund amount'}</span>
                <span className={tenantOwesMoney ? 'text-destructive' : 'text-[#243A72]'}>{fmt(Math.abs(netAmount))}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Final amounts are confirmed after inspection. This breakdown helps avoid disputes.
            </p>
          </section>
        )}

        {activeDispute && (
          <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0 space-y-2">
                <div>
                  <p className="text-sm font-bold">Dispute Submitted</p>
                  <p className="text-xs text-amber-800">Reference: {String(activeDispute.id ?? '').slice(0, 8) || 'Pending'}</p>
                </div>
                <div className="grid gap-1 text-xs sm:grid-cols-2">
                  <p>Amount disputed: <span className="font-semibold">{fmt(Number(activeDispute.disputed_amount ?? 0))}</span></p>
                  <p>Status: <span className="font-semibold">{String(activeDispute.status ?? 'OPEN').replace(/_/g, ' ')}</span></p>
                </div>
                <p className="text-xs text-amber-800">
                  Awaiting owner review. You do not need to make payment until review is completed.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Actions section */}
        <div className="space-y-3">
          {['REQUESTED', 'SETTLEMENT_PENDING'].includes(requestStatus) && (
            <button
              type="button"
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (window.confirm('Are you sure you want to cancel this move-out request?')) {
                  cancelMutation.mutate();
                }
              }}
              className="w-full py-2.5 rounded-xl border border-destructive/30 text-destructive bg-destructive/5 font-semibold text-sm hover:bg-destructive/10 transition-colors"
            >
              {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Request'}
            </button>
          )}

          {['SETTLEMENT_PENDING', 'SETTLEMENT_APPROVED', 'PHYSICALLY_VACATED', 'SETTLEMENT_PENDING_PAYMENT'].includes(requestStatus) && (
            !showDisputeForm ? (
              <button
                type="button"
                onClick={() => setShowDisputeForm(true)}
                className="w-full py-2.5 rounded-xl border border-border bg-card font-semibold text-sm hover:bg-secondary/20 transition-colors text-foreground"
              >
                Raise a Dispute
              </button>
            ) : (
              <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                <h3 className="text-sm font-semibold">Raise a Dispute</h3>
                
                <label className="block text-xs">
                  Dispute Type
                  <select
                    value={disputeType}
                    onChange={(e) => setDisputeType(e.target.value)}
                    className="mt-1 w-full px-2.5 py-2 rounded-lg border border-border bg-background"
                  >
                    <option value="DAMAGE_CHARGE_DISPUTE">Damage charge dispute</option>
                    <option value="CLEANING_FEE_DISPUTE">Cleaning fee dispute</option>
                    <option value="MISSING_ITEMS_DISPUTE">Missing items dispute</option>
                    <option value="RENT_DUES_DISPUTE">Incorrect rent calculation</option>
                    <option value="DEPOSIT_REFUND_DISPUTE">Incorrect deposit amount</option>
                    <option value="SETTLEMENT_DISPUTE">Other settlement dispute</option>
                  </select>
                </label>

                <label className="block text-xs">
                  Disputed Amount (₹) - optional
                  <input
                    type="number"
                    min="0"
                    placeholder="Amount you are contesting"
                    value={disputedAmount}
                    onChange={(e) => setDisputedAmount(e.target.value)}
                    className="mt-1 w-full px-2.5 py-2 rounded-lg border border-border bg-background"
                  />
                </label>

                <label className="block text-xs">
                  Description of Dispute
                  <textarea
                    rows={3}
                    placeholder="Provide details of why you disagree with the calculations..."
                    value={disputeDescription}
                    onChange={(e) => setDisputeDescription(e.target.value)}
                    className="mt-1 w-full px-2.5 py-2 rounded-lg border border-border bg-background"
                  />
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowDisputeForm(false)}
                    className="flex-1 py-2 rounded-lg border border-border font-medium text-xs text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={disputeMutation.isPending || !disputeDescription}
                    onClick={() =>
                      disputeMutation.mutate({
                        disputeType,
                        description: disputeDescription,
                        disputedAmount: Number(disputedAmount) || 0,
                      })
                    }
                    className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground font-semibold text-xs disabled:opacity-50"
                  >
                    {disputeMutation.isPending ? 'Submitting...' : 'Submit Dispute'}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // --- Wizard: Screen 1 (Exit Date Choice) ---
  if (wizardStep === 1) {
    const isTodayChoice = dateChoice === 'TODAY';
    const isLaterChoice = dateChoice === 'LATER';

    return (
      <div className="space-y-6">
        <header className="overflow-hidden rounded-2xl border border-blue-500/20 bg-card shadow-sm">
          <div 
            className="px-5 py-5 text-white relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #1B2D5B 0%, #243A72 100%)' }}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16" />
            <div className="relative flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <DoorOpen className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-100/80">Exit workflow</p>
                <h1 className="text-2xl font-bold leading-tight">Move Out Request</h1>
              </div>
            </div>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground font-semibold">
              Tell us when you plan to leave.
            </p>
          </div>
        </header>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setDateChoice('TODAY');
              setPlannedDate('');
            }}
            className={`w-full p-4 rounded-xl border text-left flex items-center justify-between transition-all ${
              isTodayChoice
                ? 'border-[#243A72] bg-[#243A72]/5 text-[#243A72]'
                : 'border-border bg-card text-foreground hover:bg-secondary/10'
            }`}
          >
            <div>
              <p className="font-semibold text-sm">Leaving Today</p>
              <p className="text-xs text-muted-foreground mt-0.5">Process your exit immediately</p>
            </div>
            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
              isTodayChoice ? 'border-[#243A72] bg-[#243A72]' : 'border-muted-foreground'
            }`}>
              {isTodayChoice && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setDateChoice('LATER')}
            className={`w-full p-4 rounded-xl border text-left flex items-center justify-between transition-all ${
              isLaterChoice
                ? 'border-[#243A72] bg-[#243A72]/5 text-[#243A72]'
                : 'border-border bg-card text-foreground hover:bg-secondary/10'
            }`}
          >
            <div>
              <p className="font-semibold text-sm">Leaving Later</p>
              <p className="text-xs text-muted-foreground mt-0.5">Select a future date for your exit</p>
            </div>
            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
              isLaterChoice ? 'border-[#243A72] bg-[#243A72]' : 'border-muted-foreground'
            }`}>
              {isLaterChoice && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
            </div>
          </button>
        </div>

        {isLaterChoice && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Select Date
            </label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={plannedDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm text-foreground focus:border-[#243A72] focus:ring-1 focus:ring-[#243A72]"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!dateChoice || (isLaterChoice && !plannedDate)}
          onClick={() => setWizardStep(2)}
          className="w-full py-3.5 rounded-xl bg-[#243A72] text-white font-semibold hover:bg-[#1B2D5B] transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <span>Continue</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // --- Wizard: Screen 2 (Reason for leaving) ---
  if (wizardStep === 2) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Why Are You Leaving?</h1>
          <p className="text-sm text-muted-foreground">Select a reason for requesting move-out.</p>
        </div>

        {is4thYear && (
          <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs leading-relaxed">
            ⚠️ <strong>Academic Year Rule</strong>: Since you are a 4th/final-year student, your move-out reason is set to <strong>Course Completed</strong>.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => {
            const selected = reason === r.value;
            const disabled = is4thYear && r.value !== 'COURSE_COMPLETED';

            return (
              <button
                key={r.value}
                type="button"
                disabled={disabled}
                onClick={() => setReason(r.value)}
                className={`py-2 px-3 rounded-full border text-xs font-semibold transition-all ${
                  selected
                    ? 'border-[#243A72] bg-[#243A72] text-white'
                    : disabled
                      ? 'border-border bg-secondary/50 text-muted-foreground opacity-40 cursor-not-allowed'
                      : 'border-border bg-card text-foreground hover:bg-secondary/10'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-foreground">
            Anything you&apos;d like us to know? <span className="text-xs font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="Share details of your exit..."
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-3 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setWizardStep(1)}
            className="flex-1 py-3 rounded-xl border border-border bg-card font-semibold text-sm hover:bg-secondary/20 transition-colors text-foreground"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!reason}
            onClick={() => setWizardStep(3)}
            className="flex-1 py-3 rounded-xl bg-[#243A72] text-white font-semibold hover:bg-[#1B2D5B] transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <span>Continue</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // --- Wizard: Screen 3 (Settlement Preview) ---
  const depositPaid = Number(advance?.security_deposit_paid ?? advance?.balance ?? 0);
  const duesOutstanding = Number(dues?.total_due ?? 0);
  const expectedRefund = depositPaid - duesOutstanding;
  const refundDirection = expectedRefund >= 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Settlement Preview</h1>
        <p className="text-sm text-muted-foreground">Full transparency on dues and deposit.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid Security Deposit</span>
            <span className="font-semibold text-foreground">{fmt(depositPaid)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pending Rent & Dues</span>
            <span className="font-semibold text-destructive">−{fmt(duesOutstanding)}</span>
          </div>
          <div className="flex justify-between pt-2.5 border-t border-border font-extrabold text-base">
            <span>{refundDirection ? 'Expected Refund' : 'Expected Dues'}</span>
            <span className={refundDirection ? 'text-[#243A72]' : 'text-destructive'}>
              {fmt(Math.abs(expectedRefund))}
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Final amounts are calculated after inspection. This preview helps avoid disputes.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setWizardStep(2)}
          className="flex-1 py-3 rounded-xl border border-border bg-card font-semibold text-sm hover:bg-secondary/20 transition-colors text-foreground"
        >
          Back
        </button>
        <button
          type="button"
          disabled={submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
          className="flex-1 py-3 rounded-xl bg-[#243A72] text-white font-semibold hover:bg-[#1B2D5B] transition-colors disabled:opacity-50"
        >
          {submitMutation.isPending ? 'Submitting...' : 'Confirm Request'}
        </button>
      </div>
    </div>
  );
}
