import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Phone, MessageSquare, FileText, History, ShieldCheck, StickyNote, Plus, Clock, ArrowRight } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { queryKeys } from '@lib/queryKeys';
import { useTenantActions } from '@features/tenants/hooks/useTenantActions';
import { CreateObligationModal } from '@features/tenants/components/financial/CreateObligationModal';
import { ChangeFrequencyModal } from '@/app/components/modals/ChangeFrequencyModal';
import { ChangeRequestDrawer } from '@features/change-management';
import { useTenantDetail, type RealTenantDocument } from '../hooks/useTenantDetail';
import { useDocumentVerification } from '../hooks/useDocumentVerification';
import { DocumentReviewCard } from '../documents/DocumentReviewCard';
import { ActivationStepTracker } from '../activation/ActivationStepTracker';
import { useActivationState } from '../hooks/useActivationState';
import { RejectDocumentSheet } from '../documents/RejectDocumentSheet';
import type { TenantDetailTab } from '../types';
import { InvitedTenantProfileView } from '../components/InvitedTenantProfileView';
import { TenantHistoryPanel } from '../components/TenantHistoryPanel';
import { TenantActionsSheet } from '../actions/TenantActionsSheet';
import { ChangeRentModal } from '../actions/ChangeRentModal';
import { MoveOutSheet } from '../actions/MoveOutSheet';
import { QuickCollectModal } from '../quick-collect/QuickCollectModal';

const TABS: { id: TenantDetailTab; label: string }[] = [
  { id: 'charges', label: 'Charges' },
  { id: 'activity', label: 'Activity' },
  { id: 'documents', label: 'Documents' },
  { id: 'stay', label: 'Stay' },
];

const OBLIGATION_TONE: Record<string, 'destructive' | 'warning' | 'success' | 'neutral'> = {
  PENDING: 'destructive',
  OVERDUE: 'destructive',
  UPCOMING: 'warning',
  PAID: 'success',
};

/**
 * Tenant Detail — a real route (`/owner/tenants/:tenantId`), not a modal.
 * Full-screen takeover with its own back button, no OwnerAppShell bottom
 * nav, matching the design's own full-screen overlay treatment.
 */
export function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tenant, isLoading, isError } = useTenantDetail(tenantId);

  const [activeTab, setActiveTab] = useState<TenantDetailTab>('charges');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [quickCollectOpen, setQuickCollectOpen] = useState(false);
  const [changeRentOpen, setChangeRentOpen] = useState(false);
  const [moveOutOpen, setMoveOutOpen] = useState(false);
  const [createChargeOpen, setCreateChargeOpen] = useState(false);
  const [changeBillingOpen, setChangeBillingOpen] = useState(false);
  const [requestChangeOpen, setRequestChangeOpen] = useState(false);
  const [note, setNote] = useState('');
  const [rejectingDoc, setRejectingDoc] = useState<RealTenantDocument | null>(null);

  const tenantActions = useTenantActions(tenant?.hostelId ?? '');
  const verification = useDocumentVerification(tenantId);
  const activation = useActivationState(tenantId, tenant?.status === 'invited');
  const pendingDocCount = (tenant?.documents ?? []).filter((d) => d.status === 'PENDING').length;

  if (isLoading) {
    return (
      <ThemeProvider theme="product">
        <div className="flex min-h-screen flex-col gap-4 bg-background px-4 pt-6 sm:px-6">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-32 animate-pulse rounded-[18px] bg-muted" />
          <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        </div>
      </ThemeProvider>
    );
  }

  if (!tenant || isError) {
    return (
      <ThemeProvider theme="product">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
          <p className="font-display text-lg font-bold text-foreground">Tenant not found</p>
          <button type="button" onClick={() => navigate('/owner/tenants')} className="rounded-xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground">
            Back to Tenants
          </button>
        </div>
      </ThemeProvider>
    );
  }

  if (tenant.status === 'invited') {
    return (
      <ThemeProvider theme="product">
        <InvitedTenantProfileView tenant={tenant} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme="product">
      <div className="min-h-screen bg-background [background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px] sm:mx-auto sm:max-w-[480px] sm:border-x sm:border-border">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-6 sm:px-6">
          <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-full border border-border bg-card">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
          </button>
          <span className="text-[13.5px] font-semibold text-muted-foreground">Back to Tenants</span>
        </div>

        <div className="flex flex-col gap-3.5 px-4 pb-10 sm:px-6">
          {/* profile header */}
          <div className="rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            <div className="flex items-center gap-3.5">
              <span className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-foreground font-display text-xl font-extrabold text-primary-foreground">
                {tenant.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-extrabold leading-tight text-foreground">{tenant.name}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusPill tone={tenant.status === 'active' ? 'success' : tenant.status === 'overdue' ? 'destructive' : 'warning'} variant="filter">
                    {tenant.statusLabel}
                  </StatusPill>
                  <span className="text-[11.5px] text-muted-foreground">
                    Room <b className="font-bold text-foreground">{tenant.room}</b> · Joined <b className="font-bold text-foreground">{tenant.joinedDate}</b>
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3.5 flex overflow-hidden rounded-[13px] border border-border">
              <div className="flex-1 border-r border-border px-3.5 py-2.5">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Hostel</div>
                <div className="mt-0.5 font-display text-[12.5px] font-bold text-foreground">{tenant.hostelName}</div>
              </div>
              <div className="flex-1 px-3.5 py-2.5">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Agreement</div>
                <div className="mt-0.5 font-display text-[12.5px] font-bold text-foreground">{tenant.agreementStatus === 'Signed' ? 'Active Contract' : tenant.agreementStatus}</div>
              </div>
            </div>
          </div>

          {tenant.status === 'invited' && (
            <ActivationStepTracker state={activation.state} documentVerified={tenant.kycStatus === 'Verified'} />
          )}

          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-display text-[14.5px] font-bold text-primary-foreground shadow-[0_6px_16px_rgba(143,74,56,0.28)]"
          >
            <span className="text-base">₹</span>
            Actions
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>

          {/* communication center */}
          <div>
            <h2 className="mb-2.5 px-0.5 font-display text-[15px] font-bold text-foreground">Communication Center</h2>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
                <div className="min-w-0 flex-1">
                  <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Tenant</div>
                  <div className="mt-0.5 font-display text-[13.5px] font-bold text-foreground">{tenant.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">{tenant.phone}</div>
                </div>
                <CommRowActions />
              </div>
              {tenant.guardian && (
                <div className="flex items-center gap-2.5 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Guardian ({tenant.guardian.relation})</div>
                    <div className="mt-0.5 font-display text-[13.5px] font-bold text-foreground">{tenant.guardian.name}</div>
                    <div className="text-[11.5px] text-muted-foreground">{tenant.guardian.phone}</div>
                  </div>
                  <CommRowActions />
                </div>
              )}
            </div>
          </div>

          {/* risk & compliance */}
          <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-[11px] bg-success/10">
                <ShieldCheck className="h-4.5 w-4.5 text-success" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Risk &amp; Compliance</div>
                <div className="font-display text-lg font-extrabold tabular-nums text-foreground">
                  {tenant.riskScore}
                  <span className="text-[11px] font-semibold text-muted-foreground">/100</span>
                </div>
              </div>
              <StatusPill tone={tenant.riskScore >= 70 ? 'success' : tenant.riskScore >= 40 ? 'warning' : 'destructive'} variant="filter">
                {tenant.riskLabel}
              </StatusPill>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <RiskTile label="Trend" value={tenant.riskTrend} />
              <RiskTile label="Agreement" value={tenant.agreementStatus} />
              <RiskTile label="KYC Verify" value={tenant.kycStatus} />
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-success/10 p-3">
              <Clock className="mt-0.5 h-4 w-4 flex-none text-success" strokeWidth={1.8} />
              <p className="text-[12px] font-semibold leading-relaxed text-success">{tenant.riskInsight}</p>
            </div>
          </div>

          {/* private notes */}
          <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary" strokeWidth={1.8} />
              <span className="font-display text-sm font-extrabold text-foreground">Private Notes</span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-muted-foreground">OWNER ONLY</span>
            </div>
            <div className="flex items-center gap-2.5">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add an owner-private note…"
                className="min-w-0 flex-1 rounded-[11px] border border-border bg-muted px-3.5 py-2.5 text-[12.5px] text-foreground focus:outline-none"
              />
              <button type="button" aria-label="Add note" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-4 w-4" strokeWidth={2.4} />
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">No private notes yet. Notes are only visible to you and co-owners.</p>
          </div>

          {/* money stat cards */}
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
            <div className="min-w-[150px] flex-none rounded-2xl border border-primary/20 bg-secondary/40 p-3.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Outstanding</div>
              <div className="mt-1 font-display text-xl font-extrabold tabular-nums text-primary">₹{tenant.outstanding.toLocaleString('en-IN')}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{tenant.overdueMonths > 0 ? `${tenant.overdueMonths} months overdue` : 'No immediate dues'}</div>
            </div>
            <div className="min-w-[150px] flex-none rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Overdue</div>
              <div className="mt-1 font-display text-xl font-extrabold text-foreground">
                {tenant.overdueMonths} <span className="font-display text-[13px] font-bold text-muted-foreground">days</span>
              </div>
              <div className={`mt-0.5 text-[11px] ${tenant.overdueMonths > 0 ? 'text-destructive' : 'text-success'}`}>
                {tenant.overdueMonths > 0 ? 'Needs follow-up' : 'Paid on time'}
              </div>
            </div>
            <div className="min-w-[150px] flex-none rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Deposit</div>
              <div className="mt-1 font-display text-xl font-extrabold tabular-nums text-foreground">₹{tenant.stay.deposit.toLocaleString('en-IN')}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">Held on file</div>
            </div>
          </div>

          {tenant.outstanding > 0 && (
            <div className="flex flex-col gap-2.5 rounded-[18px] border border-primary/20 bg-gradient-to-br from-secondary/60 to-secondary/20 p-4">
              <div className="flex items-center gap-2.5">
                <Clock className="h-4.5 w-4.5 flex-none text-primary" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-extrabold text-foreground">
                    {tenant.overdueMonths > 0 ? 'Overdue Payments' : 'Partial Payments Pending'}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    ₹{tenant.outstanding.toLocaleString('en-IN')} {tenant.overdueMonths > 0 ? 'overdue.' : 'pending — not yet overdue.'}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setQuickCollectOpen(true)} className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 font-display text-[13px] font-bold text-primary-foreground">
                Collect Now
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </div>
          )}

          {/* tabs */}
          <div className="sticky top-0 z-10 flex gap-1 rounded-[14px] bg-muted p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex-1 rounded-xl py-2.5 text-center font-display text-[12.5px] font-bold ${
                  activeTab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'charges' && (
            <div className="rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="mb-1 flex items-center gap-2.5">
                <span className="flex-1 font-display text-[15px] font-bold text-foreground">Charges</span>
                <button type="button" className="rounded-lg bg-secondary px-3 py-1.5 font-display text-[11.5px] font-bold text-primary">
                  + Add Charge
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">Showing the last {tenant.obligations.length} charges</p>
              <div className="flex flex-col gap-2 pt-2">
                {tenant.obligations.map((ob) => (
                  <div key={ob.id} className="flex items-center gap-2.5 rounded-[14px] border border-border bg-muted/50 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15px] font-extrabold tabular-nums text-foreground">₹{ob.amount.toLocaleString('en-IN')}</div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {ob.dueLabel} · Type: {ob.type} · {ob.month}
                      </div>
                    </div>
                    <StatusPill tone={OBLIGATION_TONE[ob.status]}>{ob.status}</StatusPill>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="mb-3 font-display text-[15px] font-bold text-foreground">Activity</div>
              <div className="flex flex-col gap-2">
                {tenant.activity.map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5 rounded-xl bg-muted/50 p-3">
                    <span
                      className={`mt-0.5 h-2 w-2 flex-none rounded-full ${
                        a.tone === 'positive' ? 'bg-success' : a.tone === 'negative' ? 'bg-destructive' : 'bg-muted-foreground'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-bold leading-tight text-foreground">{a.title}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{a.sub}</div>
                    </div>
                    {a.amount != null && <div className="flex-none font-display text-[13px] font-extrabold tabular-nums text-foreground">₹{a.amount.toLocaleString('en-IN')}</div>}
                    <div className="flex-none text-[10px] text-muted-foreground">{a.date}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between px-0.5">
                <span className="font-display text-[15px] font-bold text-foreground">Documents</span>
                {pendingDocCount > 0 && (
                  <span className="text-[11.5px] font-semibold text-warning">
                    {pendingDocCount} awaiting your review
                  </span>
                )}
              </div>
              {tenant.documents.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No documents yet"
                  description={`${tenant.name} hasn't uploaded any KYC documents.`}
                />
              ) : (
                tenant.documents.map((doc) => (
                  <DocumentReviewCard
                    key={doc.id}
                    doc={doc}
                    isBusy={verification.isApproving || verification.isRejecting}
                    onApprove={(documentId) => verification.approve({ documentId })}
                    onReject={(d) => setRejectingDoc(d)}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'stay' && (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
                <div className="px-4 pb-1 pt-3.5 font-display text-[15px] font-bold text-foreground">Stay Details</div>
                <StayRow label="Hostel" value={tenant.stay.hostelName} />
                <StayRow label="Room / Bed" value={tenant.stay.roomBed} />
                <StayRow label="Move-in date" value={tenant.stay.moveInDate} />
                <StayRow label="Agreement period" value={tenant.stay.agreementPeriod} />
                <StayRow label="Monthly rent" value={`₹${tenant.stay.monthlyRent.toLocaleString('en-IN')} / month`} />
                <StayRow label="Security deposit" value={`₹${tenant.stay.deposit.toLocaleString('en-IN')}`} />
                <StayRow label="Billing frequency" value={tenant.stay.billingFrequency} />
              </div>

              {/* Where they stayed before this. Disclosure is decided
                  server-side — see ADR-053's amendment; the panel renders
                  "not shared with you" rather than hiding itself, so the
                  absence of history and the absence of consent stay
                  distinguishable to the owner without leaking either. */}
              <TenantHistoryPanel tenantId={tenantId} />
              <div className="flex gap-2.5">
                <button type="button" onClick={() => setActionsOpen(true)} className="flex-1 rounded-xl border border-border bg-card py-3 text-center font-display text-[12.5px] font-bold text-foreground">
                  Change room
                </button>
                <button type="button" onClick={() => setChangeRentOpen(true)} className="flex-1 rounded-xl border border-border bg-card py-3 text-center font-display text-[12.5px] font-bold text-foreground">
                  Change rent
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <TenantActionsSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onCollectPayment={() => setQuickCollectOpen(true)}
        onChangeRent={() => setChangeRentOpen(true)}
        onCheckout={() => setMoveOutOpen(true)}
        onShareLink={() => tenantActions.sharePaymentLink(tenant.id, tenant.phone, tenant.outstanding || undefined)}
        onCreateCharge={() => setCreateChargeOpen(true)}
        onViewReceipts={() => setActiveTab('activity')}
        onRequestChange={() => setRequestChangeOpen(true)}
        onChangeBilling={() => setChangeBillingOpen(true)}
      />
      <QuickCollectModal
        open={quickCollectOpen}
        onClose={() => setQuickCollectOpen(false)}
        initialTenant={{
          id: tenant.id,
          name: tenant.name,
          initials: tenant.initials,
          phone: tenant.phone,
          hostelId: tenant.hostelId,
          hostelName: tenant.hostelName,
          room: tenant.room,
          outstanding: tenant.outstanding,
          deposit: tenant.stay.deposit,
          obligations: tenant.obligations,
        }}
      />
      <ChangeRentModal
        open={changeRentOpen}
        onClose={() => setChangeRentOpen(false)}
        tenantId={tenant.id}
        hostelId={tenant.hostelId}
        tenantName={tenant.name}
        currentRent={tenant.stay.monthlyRent}
      />
      <MoveOutSheet
        open={moveOutOpen}
        onClose={() => setMoveOutOpen(false)}
        tenantId={tenant.id}
        hostelId={tenant.hostelId}
        tenantName={tenant.name}
        roomNo={tenant.room}
      />
      {createChargeOpen && (
        <CreateObligationModal
          isOpen={createChargeOpen}
          onClose={() => setCreateChargeOpen(false)}
          tenantId={tenant.id}
          hostelId={tenant.hostelId}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
            queryClient.invalidateQueries({ queryKey: queryKeys.payments.all(tenant.hostelId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
          }}
        />
      )}
      {changeBillingOpen && (
        <ChangeFrequencyModal
          tenantId={tenant.id}
          currentFrequency={tenant.stay.billingFrequency}
          onClose={() => setChangeBillingOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
            queryClient.invalidateQueries({ queryKey: queryKeys.payments.all(tenant.hostelId) });
          }}
        />
      )}
      <ChangeRequestDrawer
        open={requestChangeOpen}
        onClose={() => setRequestChangeOpen(false)}
        tenantId={tenant.id}
        hostelId={tenant.hostelId}
        tenantData={{
          name: tenant.name,
          phone_1: tenant.phone,
          monthly_rent: tenant.stay.monthlyRent,
          security_deposit: tenant.stay.deposit,
        }}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] })}
      />
      <RejectDocumentSheet
        open={rejectingDoc != null}
        docType={rejectingDoc?.docType ?? ''}
        tenantName={tenant.name}
        isSubmitting={verification.isRejecting}
        onClose={() => setRejectingDoc(null)}
        onConfirm={async (reason) => {
          if (!rejectingDoc) return;
          await verification.rejectAsync({ documentId: rejectingDoc.id, reason });
          setRejectingDoc(null);
        }}
      />
    </ThemeProvider>
  );
}

function CommRowActions() {
  return (
    <div className="flex flex-none gap-1.5">
      {[Phone, MessageSquare, FileText, History].map((Icon, i) => (
        <span key={i} className="flex h-8.5 w-8.5 items-center justify-center rounded-full bg-muted">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
        </span>
      ))}
    </div>
  );
}

function RiskTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/50 p-2.5 text-center">
      <span className="font-display text-[11px] font-bold text-foreground">{label}</span>
      <span className="text-[10.5px] text-muted-foreground">{value}</span>
    </div>
  );
}

function StayRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-display text-[13px] font-bold text-foreground">{value}</span>
    </div>
  );
}
