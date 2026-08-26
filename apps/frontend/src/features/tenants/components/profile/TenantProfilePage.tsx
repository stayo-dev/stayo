import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  LogOut, AlertTriangle, AlertCircle,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { tenantService } from '@features/tenants/api';
import { paymentService } from '@features/payments/api';
import { ownerService } from '@features/owners/api';
import { useTenantProfile } from '@features/tenants/hooks/useTenantProfile';
import { useOwnerActions } from '@features/owner-actions/hooks/useOwnerActions';
import { TenantStatusBadge } from '@features/tenants/components/badges/TenantStatusBadge';
import { RentObligationList } from '@features/tenants/components/financial/RentObligationList';
import { WaiveObligationModal } from '@features/tenants/components/financial/WaiveObligationModal';
import { CancelObligationModal } from '@features/tenants/components/financial/CancelObligationModal';
import { CreateObligationModal } from '@features/tenants/components/financial/CreateObligationModal';
import { ObligationHistorySheet } from '@features/tenants/components/financial/ObligationHistorySheet';
import { CompactFinancialStrip, type FinancialSectionId } from '@features/tenants/components/financial/CompactFinancialStrip';
import { FinancialHealthBanner } from '@features/tenants/components/financial/FinancialHealthBanner';
import { PrimaryActionsBar } from '@features/tenants/components/financial/PrimaryActionsBar';
import { UnifiedActivityTimeline } from '@features/tenants/components/profile/UnifiedActivityTimeline';
import { DocumentsTab } from '@features/tenants/components/profile/DocumentsTab';
import { AllocationHistoryTimeline } from '@features/tenants/components/allocation/AllocationHistoryTimeline';
import { MoveOutSheet } from '@features/owner-tenants/actions/MoveOutSheet';
import { getInitials } from '@features/tenants/utils/normalize';
import { RecordPaymentModal } from '@/app/components/modals/RecordPaymentModal';
import { CorrectPaymentModal } from '@/app/components/modals/CorrectPaymentModal';
import { ChangeRentModal } from '@/app/components/modals/ChangeRentModal';
import { ChangeFrequencyModal } from '@/app/components/modals/ChangeFrequencyModal';
import { hmsToast } from '@lib/toast';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/components/ui/tabs';
import api from '@lib/api-client';
import { queryKeys } from '@lib/queryKeys';
import { EditInviteModal } from '@/app/components/modals/EditInviteModal';
import {
  ChangeRequestDrawer,
  PendingBanner,
  useTenantChangeRequests,
} from '@/features/change-management';

import { RiskComplianceCard } from '@features/tenants/components/profile/RiskComplianceCard';
import { PrivateNotes } from '@features/tenants/components/profile/PrivateNotes';
import { CommunicationCenter } from '@features/tenants/components/profile/CommunicationCenter';
import { StayoLoadingBlock } from '@shared/ui/brand';

const date = (value: unknown) => (value ? new Date(String(value)).toLocaleDateString('en-IN') : '—');

const positiveAmount = (value: unknown) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

function firstPositiveAmount(...values: unknown[]) {
  for (const value of values) {
    const amount = positiveAmount(value);
    if (amount !== null) return amount;
  }
  return 0;
}

function findSecurityDepositFromObligations(obligations: Record<string, unknown>[]) {
  const deposit = obligations.find((item) => {
    const type = String(
      item.obligation_type ?? item.type ?? item.category ?? item.label ?? '',
    ).toUpperCase();
    return type.includes('ADVANCE') || type.includes('DEPOSIT');
  });
  return positiveAmount(
    deposit?.amount ?? deposit?.original_amount ?? deposit?.remaining ?? deposit?.outstanding,
  );
}

function listFrom<T = Record<string, unknown>>(value: unknown, keys: string[] = []): T[] {
  if (Array.isArray(value)) return value as T[];
  const record = value as Record<string, unknown> | undefined;
  for (const key of keys) {
    if (Array.isArray(record?.[key])) return record[key] as T[];
  }
  return [];
}

type ObligationModalState = {
  mode: 'create' | 'duplicate' | 'edit';
  initialValues?: { obligationType?: string; amount?: number; description?: string };
  replaceObligation?: any;
} | null;

interface TenantProfilePageProps {
  hostelIdProp?: string;
  tenantIdProp?: string;
  onBack?: () => void;
}

export function TenantProfilePage({ hostelIdProp, tenantIdProp, onBack }: TenantProfilePageProps = {}) {
  const queryClient = useQueryClient();
  const params = useParams();
  const hostelId = hostelIdProp ?? params.hostelId ?? '';
  const tenantId = tenantIdProp ?? params.tenantId ?? '';
  const navigate = useNavigate();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payObligationId, setPayObligationId] = useState<string | null>(null);
  const [paymentPrefillAmount, setPaymentPrefillAmount] = useState<number | undefined>(undefined);
  const [showEditInvite, setShowEditInvite] = useState(false);
  const [showChangeDrawer, setShowChangeDrawer] = useState(false);
  const [showCreateObligationModal, setShowCreateObligationModal] = useState(false);
  const [waiveObligation, setWaiveObligation] = useState<any>(null);
  const [cancelObligationTarget, setCancelObligationTarget] = useState<any>(null);
  const [historyObligation, setHistoryObligation] = useState<any>(null);
  const [obligationModal, setObligationModal] = useState<ObligationModalState>(null);
  type TabId = 'obligations' | 'activity' | 'documents' | 'stay';
  const [activeTab, setActiveTab] = useState<TabId>('obligations');
  const [correctingPaymentId, setCorrectingPaymentId] = useState<string | null>(null);
  const [showChangeRent, setShowChangeRent] = useState(false);
  const [showMoveOut, setShowMoveOut] = useState(false);
  const [showChangeFrequency, setShowChangeFrequency] = useState(false);

  const { overview, allocations, dues, advance, full, financialTimeline, isLoading, isError, refetch } =
    useTenantProfile(hostelId, tenantId);

  // The tenant overview response doesn't carry the hostel's name/city, so
  // resolve it from the owner's hostel list — usually already warm in cache
  // from Portfolio/Hostels, since that's how an owner gets here.
  const { data: hostelsRaw } = useQuery({
    queryKey: queryKeys.owner.hostels(),
    queryFn: () => ownerService.getHostels(),
    enabled: Boolean(hostelId),
    staleTime: 5 * 60_000,
  });
  const hostelsList = Array.isArray(hostelsRaw)
    ? hostelsRaw
    : ((hostelsRaw as any)?.hostels ?? (hostelsRaw as any)?.data?.hostels ?? []);
  const currentHostel = (hostelsList as any[]).find((h) => String(h.id) === String(hostelId));
  const hostelLocationLabel = String(currentHostel?.name || currentHostel?.city || overview?.hostel_name || 'Hostel');

  const { findAction } = useOwnerActions(hostelId, tenantId);
  const personalInfoAction = findAction('TENANT_EDIT_PERSONAL_INFO');

  // Change Management: fetch pending requests for this tenant
  const {
    pendingCount: crPendingCount,
    recentChanges,
    refetch: refetchChangeRequests,
  } = useTenantChangeRequests(tenantId);

  const handleChangeSuccess = useCallback(() => {
    refetch();
    refetchChangeRequests();
  }, [refetch, refetchChangeRequests]);

  const billingTimeline = useQuery({
    queryKey: ['tenant', tenantId, 'billing-timeline'],
    queryFn: () => tenantService.getTenantBillingTimeline(tenantId),
    enabled: Boolean(tenantId),
  });

  const frequencyRequests = useQuery({
    queryKey: ['owner', 'billing-frequency-requests', tenantId],
    queryFn: () => ownerService.getFrequencyChangeRequests({ tenantId, status: 'PENDING' }),
    enabled: Boolean(tenantId),
  });

  const decisionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'APPROVE' | 'REJECT' }) =>
      ownerService.decideFrequencyChangeRequest(id, action),
    onSuccess: () => {
      toast.success('Billing request updated');
      queryClient.invalidateQueries({ queryKey: ['owner', 'billing-frequency-requests', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'billing-timeline'] });
      refetch();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Could not update billing request');
    },
  });

  const { data: tenantScore } = useQuery({
    queryKey: ['tenant-score', tenantId],
    queryFn: () => tenantService.getTenantScore(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const profile = (overview?.profile ?? overview?.profiles ?? full?.profiles ?? {}) as Record<string, unknown>;
  const tenant = (overview?.tenant ?? overview ?? {}) as Record<string, unknown>;
  const name = String(profile?.name ?? tenant?.name ?? 'Tenant');
  const status = String(tenant?.status ?? overview?.status ?? 'ACTIVE');
  const photoUrl = String(tenant?.photo_url ?? overview?.photo_url ?? '').trim();
  const primaryPhone = String(profile?.phone ?? tenant?.phone_1 ?? overview?.phone ?? '').trim();
  const currentRoom = (tenant.current_room ?? overview?.current_room ?? null) as Record<string, unknown> | null;
  const displayedRoomNo = currentRoom?.room_no ?? tenant.room_number ?? overview?.room_number ?? null;
  const needsRoomAssignment = status.toUpperCase() === 'ACTIVE' && !displayedRoomNo;

  const obligations = listFrom(dues, ['items', 'obligations']);
  // Change Rent's month dropdown: RENT obligations with zero recorded
  // payments (paymentService.getTenantDues() already excludes fully-settled
  // obligations and computes `paid` as the sum of that obligation's
  // payments. Note: this is a *preview* filter using net paid amount
  // (paid === 0), which is not identical to the backend's real guard (zero
  // payment *records*, payments.length === 0, in applyRentChangeInTx) —
  // after a Payment Reversal correction, an obligation can net to paid === 0
  // while carrying 2 payment rows, so this count can diverge from what the
  // backend actually reprices. ChangeRentModal.tsx surfaces the real
  // obligationsUpdated count from the API response after submit specifically
  // to catch this — don't remove that as "redundant".
  const upcomingRentObligations = (obligations as Record<string, unknown>[])
    .filter((o: any) => String(o.obligation_type ?? o.type ?? '').toUpperCase() === 'RENT' && Number(o.paid ?? 0) === 0)
    .map((o: any) => ({
      id: String(o.id ?? o.obligation_id),
      rent_month: String(o.rent_month),
      amount: Number(o.outstanding ?? o.amount ?? 0),
    }))
    .sort((a, b) => a.rent_month.localeCompare(b.rent_month));
  const fullPayments = listFrom(full?.payments);
  const securityDepositAmount = firstPositiveAmount(
    tenant.security_deposit,
    overview?.security_deposit,
    tenant.advance_deposit,
    overview?.advance_deposit,
    (advance as Record<string, unknown> | undefined)?.security_deposit,
    findSecurityDepositFromObligations(obligations as Record<string, unknown>[]),
  );

  const overdueDays = useMemo(() => {
    const todayMid = new Date();
    todayMid.setUTCHours(0, 0, 0, 0);
    const overduePending = obligations.filter((o: any) => {
      if (!['PENDING', 'PARTIAL'].includes(String(o.status).toUpperCase()) || !o.due_date) return false;
      const due = new Date(o.due_date);
      due.setUTCHours(0, 0, 0, 0);
      return due.getTime() < todayMid.getTime();
    });
    if (overduePending.length === 0) return 0;
    const oldestDueDate = Math.min(...overduePending.map((o: any) => new Date(o.due_date).getTime()));
    const diffDays = Math.floor((todayMid.getTime() - oldestDueDate) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  }, [obligations]);

  // Whether the tenant has a real current agreement (SIGNED/EXPIRING_SOON/AGREEMENT_EXPIRED
  // per currentAgreementWhere()) — sourced from the actual Agreement table via
  // getOwnerTenantOverview, not inferred from room-allocation history.
  const hasActiveAgreement = Boolean(overview?.has_active_agreement);

  // Agreement progress — time-based: months elapsed since agreement start / total duration (§ plan decision)
  const { agreementMonthsElapsed, agreementMonthsTotal } = useMemo(() => {
    const activeAllocation = (allocations || []).find((a: any) => a.is_active) ?? allocations?.[0];
    const startRaw = tenant?.agreement_start_date ?? overview?.agreement_start_date ?? activeAllocation?.start_date;
    const durationMonths = Number(
      tenant?.agreement_duration_months ?? overview?.agreement_duration_months ?? 0,
    );
    if (!startRaw || !durationMonths) return { agreementMonthsElapsed: null, agreementMonthsTotal: null };
    const start = new Date(startRaw);
    if (Number.isNaN(start.getTime())) return { agreementMonthsElapsed: null, agreementMonthsTotal: null };
    const now = new Date();
    const elapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return {
      agreementMonthsElapsed: Math.max(0, Math.min(durationMonths, elapsed)),
      agreementMonthsTotal: durationMonths,
    };
  }, [allocations, tenant, overview]);

  if (isLoading) {
    return (
      <StayoLoadingBlock className="py-24 text-primary" size="lg" />
    );
  }

  if (isError || !overview) {
    return (
      <div className="text-center py-16 px-4">
        <p className="text-foreground font-medium">Failed to load tenant</p>
        <button
          type="button"
          onClick={() => (onBack ? onBack() : navigate(`/hostels/${hostelId}/tenants`))}
          className="mt-4 text-sm text-accent font-semibold"
        >
          Back to tenants
        </button>
      </div>
    );
  }

  const paymentSummary = (overview.payment_summary ??
    overview.financial_summary ?? {
      total_paid: overview.total_paid,
      pending_amount: overview.outstanding ?? overview.total_due,
      overdue_amount: overview.overdue_amount,
      deposit_balance: overview.advance_balance,
    }) as Record<string, unknown> | undefined;
  const compliance = (overview.compliance ?? {}) as Record<string, unknown>;
  const pendingBillingRequests = frequencyRequests.data?.requests ?? [];
  const recentPayments = listFrom<Record<string, unknown>>(overview.recent_payments).length
    ? listFrom<Record<string, unknown>>(overview.recent_payments)
    : fullPayments.map((payment) => ({
        id: payment.id,
        amount: payment.amount_paid,
        date: payment.payment_date,
        method: payment.payment_method,
        reference_number: payment.reference_number,
      }));

  const runComplianceAction = async (action: string, success: string) => {
    try {
      await tenantService.runComplianceAction(tenantId, action);
      toast.success(success);
      refetch();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Action failed';
      toast.error(message);
    }
  };

  const downloadAcceptanceRecord = () => {
    if (!compliance?.rules_accepted) {
      toast.error('No rules acceptance record yet');
      return;
    }
    const record = {
      tenant_id: tenantId,
      tenant_name: name,
      accepted_at: compliance.rules_accepted_at,
      rules_version: compliance.rules_version,
      rule_version_id: compliance.rule_version_id,
      rules_snapshot: compliance.rules_snapshot,
    };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '-').toLowerCase()}-rules-acceptance.json`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 250);
  };

  const overdueAmount = Number(paymentSummary?.overdue_amount ?? overview?.overdue_amount ?? 0);
  const outstandingAmount = Number(paymentSummary?.pending_amount ?? overview.outstanding ?? 0);
  const futureCredit = Number((advance as any)?.balance ?? (advance as any)?.current_balance ?? (advance as any)?.future_rent_credit ?? 0);
  const isOverdue = overdueAmount > 0;
  const nextRentGeneration = billingTimeline.data?.next_rent_generation;
  const nextRentDate = nextRentGeneration?.next_installment_due_date ?? null;
  const nextRentAmount = nextRentGeneration?.next_installment_amount ?? null;
  const nextRentLabel = nextRentGeneration?.installment_label ?? (nextRentDate ? date(nextRentDate) : null);

  const financialEvents = (financialTimeline as any)?.events ?? [];

  // ── Financial section navigation: switches the real tab ────────────────────
  const handleNavigate = (section: FinancialSectionId) => {
    const tabForSection: Partial<Record<FinancialSectionId, TabId>> = {
      'fin-obligations': 'obligations',
      'fin-activity': 'activity',
      'fin-ledger': 'activity',
      'fin-documents': 'documents',
    };
    const tab = tabForSection[section];
    if (tab) setActiveTab(tab);
  };

  const handleOpenReceivePayment = (prefillAmount?: number) => {
    setPayObligationId(null);
    setPaymentPrefillAmount(prefillAmount);
    setShowPaymentModal(true);
  };

  const handleDownloadReceipt = async (paymentId: string) => {
    try {
      const blob = await paymentService.downloadReceipt(paymentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${paymentId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 250);
    } catch (e: any) {
      hmsToast.error(e, 'Download receipt');
    }
  };

  // ── Obligation card actions ────────────────────────────────────────────────
  const handleEditObligationSuccess = () => {
    const source = obligationModal?.replaceObligation;
    setObligationModal(null);
    refetch();
    if (source) {
      // Obligations are immutable — editing creates a corrected replacement, then
      // the original is cancelled to avoid double-counting. See plan §1 decision.
      setCancelObligationTarget({ ...source, __editReason: 'Superseded by edit' });
    }
  };

  const obligationsSection = (
    <div id="fin-obligations" className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4 scroll-mt-20">
      <div className="flex justify-between items-center border-b border-border pb-3">
        <h3 className="text-sm font-bold text-foreground">Charges</h3>
        <button
          type="button"
          onClick={() => setObligationModal({ mode: 'create' })}
          className="py-1.5 px-3 rounded-xl bg-accent/15 hover:bg-accent/20 text-accent text-xs font-semibold active:scale-95 transition-transform border border-accent/20"
        >
          + Add Charge
        </button>
      </div>
      <RentObligationList
        obligations={obligations as never[]}
        tenantPhone={primaryPhone}
        onRecordPayment={(id) => {
          setPayObligationId(id);
          setPaymentPrefillAmount(undefined);
          setShowPaymentModal(true);
        }}
        onWaiveObligation={(ob) => setWaiveObligation(ob)}
        onCancelObligation={(ob) => setCancelObligationTarget(ob)}
        onEditObligation={(ob) =>
          setObligationModal({
            mode: 'edit',
            initialValues: {
              obligationType: ob.obligation_type ?? ob.type,
              amount: Number(ob.outstanding ?? ob.amount ?? 0),
              description: ob.description,
            },
            replaceObligation: ob,
          })
        }
        onDuplicateObligation={(ob) =>
          setObligationModal({
            mode: 'duplicate',
            initialValues: {
              obligationType: ob.obligation_type ?? ob.type,
              amount: Number(ob.amount ?? 0),
              description: ob.description,
            },
          })
        }
        onViewHistory={(ob) => setHistoryObligation(ob)}
        hasActivePlan={Number(tenant?.monthly_rent ?? overview?.rent ?? 0) > 0}
      />
    </div>
  );

  const activitySection = (
    <UnifiedActivityTimeline
      events={financialEvents}
      ledgerEntries={(advance as any)?.entries ?? []}
      isLoading={(financialTimeline as any) === undefined}
      onDownloadReceipt={handleDownloadReceipt}
      onViewObligation={() => setActiveTab('obligations')}
      onCorrectPayment={setCorrectingPaymentId}
      hostelId={hostelId}
      tenantId={tenantId}
      tenantName={name}
      tenantStatus={status}
      joinedOn={String(tenant.joined_on ?? overview.joined_at ?? '')}
      documents={(full?.identification_documents ?? full?.documents ?? [])}
      allocations={allocations}
      moveOutRequest={overview.move_out ?? overview.move_out_request}
      invitations={(tenant?.tenant_invitations ?? overview?.tenant_invitations ?? []) as any[]}
    />
  );

  const documentsSection = (
    <DocumentsTab
      hostelId={hostelId}
      tenantId={tenantId}
      profileType={String(tenant?.profile_type ?? 'STUDENT')}
      photoUrl={photoUrl}
      documents={(full?.identification_documents ?? full?.documents ?? []) as Record<string, unknown>[]}
      documentVerificationStatus={String(compliance.document_verification_status ?? 'MISSING').toUpperCase()}
      onDocumentsUpdated={refetch}
      onRemindDocuments={() => runComplianceAction('REMIND_DOCUMENTS', 'Document reminder sent')}
      onResendRules={() => runComplianceAction('RESEND_RULES', 'Rules reminder sent')}
      onDownloadAcceptanceRecord={downloadAcceptanceRecord}
      hasAgreement={hasActiveAgreement}
      recentPayments={recentPayments as any}
      recentChanges={recentChanges as any}
      onViewAllChanges={() => navigate(`/changes?tenantId=${tenantId}`)}
    />
  );

  const staySection = (
    <div className="space-y-6">
      <AllocationHistoryTimeline
        hostelId={hostelId}
        tenantId={tenantId}
        allocations={allocations}
        currentRoom={currentRoom}
        onChanged={refetch}
      />
      {/*
        * One move-out implementation, not two. This used to render
        * `ExitWorkflowSection`, a second copy of the same pipeline that had
        * already drifted from the sheet — it let the owner overwrite the
        * settlement amount and direction by hand, which the sheet never did.
        * Both are now the same `MoveOutSheet`.
        */}
      <div className="border-t border-border/60 pt-5">
        <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
          <LogOut className="w-4 h-4 text-rose-500" />
          Move Out
        </h4>
        <button
          type="button"
          onClick={() => setShowMoveOut(true)}
          className="w-full rounded-xl border border-border bg-card py-3 font-display text-sm font-bold text-foreground"
        >
          Open move-out
        </button>
      </div>
    </div>
  );

  return (
    <div className="px-4 py-5 max-w-7xl mx-auto pb-24 min-w-0 space-y-6">
      {/* Top Navigation */}
      <button
        type="button"
        onClick={() => (onBack ? onBack() : navigate(`/hostels/${hostelId}/tenants`))}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Tenants
      </button>

      {/* Header Profile Banner */}
      <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-accent/15 overflow-hidden flex items-center justify-center text-xl font-bold text-accent shrink-0">
            {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : getInitials(name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-black text-foreground tracking-tight">{name}</h1>
              <TenantStatusBadge status={status} size="md" />
              {isOverdue && (
                <span className="inline-flex items-center rounded-full border font-bold px-2.5 py-0.5 text-[10px] uppercase bg-rose-500/15 text-rose-600 border-rose-500/30">
                  Overdue
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground font-medium flex flex-wrap gap-x-2 gap-y-1 items-center">
              <span>Room: <strong className="text-foreground">{displayedRoomNo ?? 'Not assigned'}</strong></span>
              <span className="text-muted-foreground/30">•</span>
              <span>Joined: <strong className="text-foreground">{date(tenant.joined_on ?? overview.joined_at)}</strong></span>
              {(tenant.exit_date ?? overview?.exit_date) && (
                <>
                  <span className="text-muted-foreground/30">•</span>
                  <span>Move-out: <strong className="text-foreground">{date(tenant.exit_date ?? overview.exit_date)}</strong></span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="w-full md:w-auto p-3.5 rounded-xl bg-secondary/40 border border-border flex items-center justify-between gap-6 shrink-0 text-xs">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Hostel Location</span>
            <span className="font-bold text-foreground mt-0.5 block">{hostelLocationLabel}</span>
          </div>
          <div className="border-l border-border h-8 self-center" />
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Rent Agreement</span>
            <span className="font-bold text-foreground mt-0.5 block">
              {hasActiveAgreement ? 'Active Contract' : 'No Active Contract'}
            </span>
          </div>
        </div>
      </div>

      {/* Change Management: Pending Banner */}
      {status.toUpperCase() === 'ACTIVE' && (
        <PendingBanner
          pendingCount={crPendingCount}
          onViewAll={() => handleNavigate('fin-documents')}
        />
      )}

      {/* Row 1: Sticky Operations & Communication Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <PrimaryActionsBar
            tenantId={tenantId}
            tenantPhone={primaryPhone}
            onReceivePayment={() => handleOpenReceivePayment()}
            onCreateCharge={() => setObligationModal({ mode: 'create' })}
            onViewReceipts={() => handleNavigate('fin-documents')}
            receiveLabel={findAction('PAYMENT_RECEIVE')?.label}
            requestChangeLabel={status.toUpperCase() === 'ACTIVE' ? (personalInfoAction?.label ?? 'Request Change') : 'Edit Details'}
            onRequestChange={() => (status.toUpperCase() === 'ACTIVE' ? setShowChangeDrawer(true) : setShowEditInvite(true))}
            canChangeRent={status.toUpperCase() === 'ACTIVE'}
            onChangeRent={() => setShowChangeRent(true)}
            canChangeFrequency={status.toUpperCase() === 'ACTIVE'}
            onChangeFrequency={() => setShowChangeFrequency(true)}
            onCheckout={() => setActiveTab('stay')}
          />
        </div>

        <div>
          <div className="h-full">
            <CommunicationCenter
              tenantName={name}
              tenantPhone={primaryPhone}
              guardianName={String(tenant.guardian_name || profile.guardian_name || '') || undefined}
              guardianPhone={String(tenant.guardian_phone || profile.guardian_phone || '') || undefined}
              guardianRelation={String(tenant.guardian_relation || profile.guardian_relation || '') || undefined}
              emergencyName={String(tenant.emergency_name || profile.emergency_name || '') || undefined}
              emergencyPhone={String(tenant.emergency_phone || profile.emergency_phone || '') || undefined}
              emergencyRelation={String(tenant.emergency_relation || profile.emergency_relation || '') || undefined}
              timelineItems={[]}
            />
          </div>
        </div>
      </div>

      {/* Row 2: Insights Grid & Private Notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <RiskComplianceCard
          score={tenantScore?.score ?? 80}
          hasAgreement={hasActiveAgreement}
          documentStatus={String(compliance.document_verification_status ?? 'MISSING').toUpperCase()}
          overdueDays={overdueDays}
          depositStatus={securityDepositAmount === 0 ? 'WAIVED' : 'PAID'}
        />

        <PrivateNotes tenantId={tenantId} />
      </div>

      {/* Warning Bar */}
      {needsRoomAssignment && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-900">Tenant requires room assignment</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                This tenant is active but not allocated to a room. Assign a room to calculate billing correctly.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('stay')}
                className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
              >
                Assign Room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending billing change request */}
      {pendingBillingRequests.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3 shadow-sm">
          <p className="text-sm font-bold text-amber-950 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            <span>Pending Frequency Request</span>
          </p>
          {pendingBillingRequests.map((request: any) => (
            <div key={request.id} className="rounded-lg bg-white border border-amber-200 p-3.5 space-y-3 shadow-xs">
              <div>
                <p className="text-xs font-bold text-foreground">
                  Change payment terms: {String(request.current_frequency).replace(/_/g, ' ')} → {String(request.requested_frequency).replace(/_/g, ' ')}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Effective Date: {request.effective_from ? new Date(request.effective_from).toLocaleDateString('en-IN') : 'next period'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={decisionMutation.isPending}
                  onClick={() => decisionMutation.mutate({ id: request.id, action: 'APPROVE' })}
                  className="bg-accent text-accent-foreground px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform"
                >
                  Approve Change
                </button>
                <button
                  type="button"
                  disabled={decisionMutation.isPending}
                  onClick={() => decisionMutation.mutate({ id: request.id, action: 'REJECT' })}
                  className="border border-border bg-background px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* §1 Summary */}
      <CompactFinancialStrip
        outstandingAmount={outstandingAmount}
        overdueDays={overdueDays}
        futureCredit={futureCredit}
        depositPaid={securityDepositAmount}
        overdueAmount={overdueAmount}
        nextRentDate={nextRentDate}
        nextRentAmount={nextRentAmount}
        agreementMonthsElapsed={agreementMonthsElapsed}
        agreementMonthsTotal={agreementMonthsTotal}
        onNavigate={handleNavigate}
      />

      {/* §1b Financial Health Banner + Recommended Next Action */}
      <FinancialHealthBanner
        overdueAmount={overdueAmount}
        overdueDays={overdueDays}
        pendingAmount={outstandingAmount}
        futureCredit={futureCredit}
        nextRentLabel={nextRentLabel}
        onCollect={(prefillAmount) => handleOpenReceivePayment(prefillAmount)}
      />

      {/* Tabbed detail region — Obligations / Activity / Documents / Stay */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="w-full overflow-x-auto scrollbar-hide">
          <TabsTrigger value="obligations">Charges</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="stay">Stay</TabsTrigger>
        </TabsList>
        <TabsContent value="obligations">{obligationsSection}</TabsContent>
        <TabsContent value="activity">{activitySection}</TabsContent>
        <TabsContent value="documents">{documentsSection}</TabsContent>
        <TabsContent value="stay">{staySection}</TabsContent>
      </Tabs>

      {/* Change Request Drawer */}
      <ChangeRequestDrawer
        open={showChangeDrawer}
        onClose={() => setShowChangeDrawer(false)}
        tenantId={tenantId}
        hostelId={hostelId}
        tenantData={{ ...tenant, ...profile }}
        onSuccess={handleChangeSuccess}
      />

      {/* Record Payment Modal */}
      {showPaymentModal && (
        <RecordPaymentModal
          hostelId={hostelId}
          context={{
            tenantId,
            obligationId: payObligationId || undefined,
            defaultAmount: paymentPrefillAmount,
            source: 'tenant-profile',
          }}
          initialTenantData={overview}
          onClose={() => {
            setShowPaymentModal(false);
            setPayObligationId(null);
            setPaymentPrefillAmount(undefined);
            refetch();
          }}
        />
      )}

      {/* Edit Invite Modal */}
      {showEditInvite && (
        <EditInviteModal
          tenantId={tenantId}
          hostelId={hostelId}
          onClose={() => {
            setShowEditInvite(false);
            refetch();
          }}
        />
      )}

      {/* Waive Obligation Modal */}
      {waiveObligation && (
        <WaiveObligationModal
          isOpen={true}
          obligation={waiveObligation}
          onClose={() => setWaiveObligation(null)}
          onConfirm={async (reason, identityToken) => {
            await api.post(`/payments/obligations/${waiveObligation.id || waiveObligation.obligation_id}/waive`, {
              reason,
              identityToken,
            });
            refetch();
          }}
        />
      )}

      {/* Cancel Obligation Modal (also used as the second step of "Edit") */}
      {cancelObligationTarget && (
        <CancelObligationModal
          isOpen={true}
          obligation={cancelObligationTarget}
          onClose={() => setCancelObligationTarget(null)}
          onConfirm={async (reason, identityToken) => {
            const id = cancelObligationTarget.id || cancelObligationTarget.obligation_id;
            await api.post(`/payments/obligations/${id}/cancel`, {
              reason: cancelObligationTarget.__editReason ?? reason,
              identityToken,
            });
            refetch();
          }}
        />
      )}

      {/* Correct Payment Modal (Reverse and Transfer are shipped — Edit Reference/Notes is a future task) */}
      {correctingPaymentId && (
        <CorrectPaymentModal
          paymentId={correctingPaymentId}
          hostelId={hostelId}
          tenantId={tenantId}
          onClose={() => {
            setCorrectingPaymentId(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.obligations(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.financialTimeline(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.advance(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.full(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.overview(hostelId, tenantId) });
            refetch();
          }}
          onSuccessReverse={() => {
            // Give the reversal's own success state (1.2s) time to display before
            // stacking a second modal — small deliberate delay, not a race condition
            // fix, since onClose() already runs on its own timer independently.
            setTimeout(() => setShowPaymentModal(true), 1300);
          }}
        />
      )}

      {/* Change Rent Modal */}
      {showChangeRent && (
        <ChangeRentModal
          tenantId={tenantId}
          hostelId={hostelId}
          currentRent={Number(tenant?.monthly_rent ?? overview?.rent ?? 0)}
          upcomingObligations={upcomingRentObligations}
          onClose={() => setShowChangeRent(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.obligations(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.financialTimeline(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.advance(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.full(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.overview(hostelId, tenantId) });
            refetch();
          }}
        />
      )}

      {/* Change Billing Frequency Modal */}
      {showChangeFrequency && (
        <ChangeFrequencyModal
          tenantId={tenantId}
          currentFrequency={String((overview as any)?.payment_frequency || 'MONTHLY')}
          onClose={() => setShowChangeFrequency(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.obligations(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.overview(hostelId, tenantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants.full(hostelId, tenantId) });
            refetch();
          }}
        />
      )}

      {/* Obligation History Sheet */}
      <ObligationHistorySheet
        obligationId={historyObligation ? (historyObligation.id || historyObligation.obligation_id) : null}
        label={historyObligation ? String(historyObligation.obligation_type || historyObligation.type || 'Charge').replace(/_/g, ' ') : ''}
        onClose={() => setHistoryObligation(null)}
      />

      {/* Create / Duplicate / Edit Obligation Modal */}
      {(showCreateObligationModal || obligationModal) && (
        <CreateObligationModal
          isOpen={true}
          tenantId={tenantId}
          hostelId={hostelId}
          mode={obligationModal?.mode ?? 'create'}
          initialValues={obligationModal?.initialValues}
          onClose={() => {
            setShowCreateObligationModal(false);
            setObligationModal(null);
          }}
          onSuccess={obligationModal?.mode === 'edit' ? handleEditObligationSuccess : () => refetch()}
        />
      )}

      <MoveOutSheet
        open={showMoveOut}
        onClose={() => {
          setShowMoveOut(false);
          refetch();
        }}
        tenantId={tenantId}
        hostelId={hostelId}
        tenantName={name}
        roomNo={displayedRoomNo}
      />
    </div>
  );
}
