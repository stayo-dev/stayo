import { useState } from 'react';
import { toast } from 'sonner';
import { tenantService } from '@features/tenants/api';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BedDouble, Clock, FileText, LogOut, Undo2 } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { queryKeys } from '@lib/queryKeys';
import { useTenantActions } from '@features/tenants/hooks/useTenantActions';
import { ChangeFrequencyModal } from '@/app/components/modals/ChangeFrequencyModal';
import { useTenantDetail } from '../hooks/useTenantDetail';
import { useDocumentVerification } from '../hooks/useDocumentVerification';
import { DocumentReviewCard } from '../documents/DocumentReviewCard';
import { documentTypeLabel, type ReviewDocument } from '../documents/kycDocuments';
import { RejectDocumentSheet } from '../documents/RejectDocumentSheet';
import type { TenantDetailTab } from '../types';
import { InvitedTenantProfileView } from '../components/InvitedTenantProfileView';
import { TenantHistoryPanel } from '../components/TenantHistoryPanel';
import { TenantActionsSheet } from '../actions/TenantActionsSheet';
import { ProfileHeader } from '../profile/ProfileHeader';
import { CommunicationCard } from '../profile/CommunicationCard';
import { PrivateNotesCard } from '../profile/PrivateNotesCard';
import { MoneyStrip } from '../profile/MoneyStrip';
import { ChangeRoomSheet } from '../profile/ChangeRoomSheet';
import { DocumentPreviewSheet } from '../profile/DocumentPreviewSheet';
import { toDocumentGroups } from '../profile/documentGroups';
import { ReviewRequestCard } from '../profile/ReviewRequestCard';
import { DocumentThread } from '../profile/DocumentThread';
import { RiskCard } from '../profile/RiskCard';
import { TenantRequestsCard } from '../profile/TenantRequestsCard';
import { CorrectPaymentModal } from '@/app/components/modals/CorrectPaymentModal';
import { useDocumentShares } from '../hooks/useDocumentShares';
import { AmendAgreementSheet } from '../profile/AmendAgreementSheet';
import { PendingChangeCard } from '../profile/PendingChangeCard';
import { ComplianceCard } from '../profile/ComplianceCard';
import { CreateChargeSheet } from '../profile/CreateChargeSheet';
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
  const [isResending, setIsResending] = useState(false);
  const [quickCollectOpen, setQuickCollectOpen] = useState(false);
  const [changeRentOpen, setChangeRentOpen] = useState(false);
  const [moveOutOpen, setMoveOutOpen] = useState(false);
  const [createChargeOpen, setCreateChargeOpen] = useState(false);
  const [changeBillingOpen, setChangeBillingOpen] = useState(false);
  const [amendAgreementOpen, setAmendAgreementOpen] = useState(false);
  const [changeRoomOpen, setChangeRoomOpen] = useState(false);
  const [correctingPaymentId, setCorrectingPaymentId] = useState<string | null>(null);
  const [rejectingDoc, setRejectingDoc] = useState<ReviewDocument | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{
    title: string;
    url: string | null;
    fileName: string;
    /** Set only for KYC documents, which are the ones that carry a thread. */
    doc?: ReviewDocument;
  } | null>(null);

  const tenantActions = useTenantActions(tenant?.hostelId ?? '');
  const verification = useDocumentVerification(tenantId);
  // Vault review requests. Additive — a hostel that has never used vault
  // sharing gets an empty list and the tab looks exactly as it did.
  const shares = useDocumentShares(tenant?.hostelId, tenant?.raw?.profile?.id);

  /**
   * Reminders already arrive on the overview response as `recent_activity`
   * rows of type "reminder" (backed by `reminder_logs`). The Communication
   * Center's history control had no data source at all before this.
   */
  const contactHistory = (tenant?.activity ?? [])
    .filter((item) => item.tone === 'negative' && /reminder/i.test(item.title))
    .slice(0, 4)
    .map((item) => ({ id: item.id, title: item.title, date: item.date }));

  const documentGroups = toDocumentGroups({
    documents: tenant?.documents,
    shares: shares.shares,
    agreement: tenant?.raw?.current_agreement ?? null,
  });
  const agreementDoc = (tenant?.documents ?? []).find((d) => d.docType === 'RENTAL_AGREEMENT') ?? null;

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
          {tenant.accessMode === 'OWNER_MANAGED' && (
            /*
             * Inviting a tenant now makes the tenancy live immediately, so
             * `status === 'invited'` is never true and the pre-activation
             * workspace below is unreachable for new tenancies. That workspace
             * shows no money, which is wrong for a tenant whose payments the
             * owner is actively recording — so the normal view stays, and the
             * one invitation action that still matters is surfaced here.
             */
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <p className="font-display text-[13.5px] font-bold text-foreground">
                You're keeping these records
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                {tenant.name.split(' ')[0]} hasn't taken charge of their account yet. Everything
                here keeps working either way — they can join anytime and pick up this same record.
              </p>
              <button
                type="button"
                disabled={isResending}
                onClick={async () => {
                  setIsResending(true);
                  try {
                    await tenantService.resendInvitation(tenant.phone);
                    toast.success('Invitation resent');
                  } catch (error: any) {
                    toast.error(
                      error?.response?.data?.error?.message || 'Failed to resend invitation',
                    );
                  } finally {
                    setIsResending(false);
                  }
                }}
                className="mt-2 font-display text-[12.5px] font-bold text-primary underline underline-offset-2 disabled:opacity-50"
              >
                {isResending ? 'Sending…' : 'Resend invite'}
              </button>
            </div>
          )}
          <ProfileHeader tenant={tenant} />

          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-display text-[14.5px] font-bold text-primary-foreground shadow-[0_6px_16px_rgba(143,74,56,0.28)]"
          >
            <span className="text-base">₹</span>
            Actions
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>

          <CommunicationCard
            overview={tenant.raw}
            hostelId={tenant.hostelId}
            history={contactHistory}
          />

          <RiskCard tenant={tenant} />

          <PrivateNotesCard tenantId={tenant.id} />

          <PendingChangeCard tenantId={tenant.id} />

          {tenant.hasOpenMoveOut && (
            <div className="flex items-center gap-2.5 rounded-[18px] border border-warning/25 bg-warning/8 p-3.5">
              <LogOut className="h-4.5 w-4.5 flex-none text-warning" strokeWidth={1.9} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[13px] font-extrabold text-foreground">Move-out in progress</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  This tenancy is being closed. Dues and deposit settle at check-out.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoveOutOpen(true)}
                className="flex-none rounded-lg bg-card px-3 py-1.5 font-display text-[11.5px] font-bold text-foreground"
              >
                Open
              </button>
            </div>
          )}

          <MoneyStrip tenant={tenant} />

          {tenant.outstanding > 0 && (
            <div className="flex flex-col gap-2.5 rounded-[18px] border border-primary/20 bg-gradient-to-br from-secondary/60 to-secondary/20 p-4">
              <div className="flex items-center gap-2.5">
                <Clock className="h-4.5 w-4.5 flex-none text-primary" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-extrabold text-foreground">
                    {tenant.overdueAmount > 0 ? 'Overdue Payments' : 'Partial Payments Pending'}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    ₹{tenant.outstanding.toLocaleString('en-IN')} {tenant.overdueAmount > 0 ? 'overdue.' : 'pending — not yet overdue.'}
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
                <button
                  type="button"
                  onClick={() => setCreateChargeOpen(true)}
                  className="rounded-lg bg-secondary px-3 py-1.5 font-display text-[11.5px] font-bold text-primary"
                >
                  + Add Charge
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {tenant.obligations.length >= 5
                  ? 'Showing the 5 most recent charges — open the full ledger for the rest.'
                  : `Showing all ${tenant.obligations.length} charge${tenant.obligations.length === 1 ? '' : 's'}.`}
              </p>
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
                  <div key={a.id} className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
                    <div className="flex items-start gap-2.5">
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
                    {/* A recorded payment can be reversed or moved to the tenant
                        it should have been credited to. The whole
                        /api/recovery/cases/* platform was unreachable from the
                        app until this button existed. */}
                    {a.type === 'payment' && (
                      <button
                        type="button"
                        onClick={() => setCorrectingPaymentId(a.id)}
                        className="flex items-center justify-center gap-1.5 self-start rounded-lg border border-border bg-card px-2.5 py-1.5 font-display text-[11px] font-bold text-foreground"
                      >
                        <Undo2 className="h-3 w-3" strokeWidth={2} />
                        Correct this payment
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between px-0.5">
                <span className="font-display text-[15px] font-bold text-foreground">Documents</span>
                {documentGroups.awaitingReviewCount > 0 && (
                  <span className="text-[11.5px] font-semibold text-warning">
                    {documentGroups.awaitingReviewCount} awaiting your review
                  </span>
                )}
              </div>

              {documentGroups.isEmpty ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No documents yet"
                  description={`${tenant.name} hasn't uploaded any KYC documents.`}
                />
              ) : (
                <>
                  {documentGroups.reviewRequests.length > 0 && (
                    <>
                      <span className="px-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Shared with you for review
                      </span>
                      {shares.shares
                        .filter((share) => share.status === 'PENDING')
                        .map((share) => (
                          <ReviewRequestCard
                            key={share.share_id}
                            share={share}
                            isBusy={shares.decide.isPending}
                            onPreview={(s) =>
                              setPreviewDoc({
                                title: documentTypeLabel(s.document.doc_type),
                                url: s.document.file_url,
                                fileName: `${s.document.doc_type.toLowerCase()}-${tenant.name.replace(/\s+/g, '-').toLowerCase()}`,
                              })
                            }
                            onDecide={(verdict, reason) =>
                              shares.decide.mutate({ shareId: share.share_id, verdict, reason })
                            }
                          />
                        ))}
                      <span className="px-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        KYC documents
                      </span>
                    </>
                  )}
                  {documentGroups.kyc.map((doc) => (
                    <DocumentReviewCard
                      key={doc.id}
                      doc={doc}
                      isBusy={verification.isApproving || verification.isRejecting}
                      onApprove={(documentId) => verification.approve({ documentId })}
                      onReject={(d) => setRejectingDoc(d)}
                      onPreview={(d) =>
                        setPreviewDoc({
                          title: documentTypeLabel(d.docType),
                          url: d.downloadUrl,
                          fileName: `${d.docType.toLowerCase()}-${tenant.name.replace(/\s+/g, '-').toLowerCase()}`,
                          doc: d,
                        })
                      }
                    />
                  ))}

                  {documentGroups.agreement && (
                    <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-bold text-foreground">Rental agreement</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {documentGroups.agreement.startDate && documentGroups.agreement.endDate
                              ? `${documentGroups.agreement.startDate} – ${documentGroups.agreement.endDate}`
                              : 'Terms not set'}
                          </div>
                        </div>
                        <StatusPill tone={documentGroups.agreement.previewable ? 'success' : 'warning'}>
                          {documentGroups.agreement.previewable ? 'Signed' : 'Awaiting signature'}
                        </StatusPill>
                      </div>
                      {documentGroups.agreement.previewable && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewDoc({
                              title: 'Rental agreement',
                              url: agreementDoc?.downloadUrl ?? null,
                              fileName: `agreement-${tenant.name.replace(/\s+/g, '-').toLowerCase()}.pdf`,
                            })
                          }
                          className="flex items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card py-2.5 font-display text-[12.5px] font-bold text-foreground"
                        >
                          <FileText className="h-3.5 w-3.5" strokeWidth={1.9} />
                          View &amp; download
                        </button>
                      )}
                    </div>
                  )}
                </>
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
              <ComplianceCard tenant={tenant} />

              <TenantRequestsCard hostelId={tenant.hostelId} tenantId={tenant.id} />

              <TenantHistoryPanel tenantId={tenantId} />
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setChangeRoomOpen(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-3 text-center font-display text-[12.5px] font-bold text-foreground"
                >
                  <BedDouble className="h-3.5 w-3.5" strokeWidth={1.9} />
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
        onRequestChange={() => setAmendAgreementOpen(true)}
        onChangeBilling={() => setChangeBillingOpen(true)}
        onChangeRoom={() => setChangeRoomOpen(true)}
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
        tenantStatus={tenant.status}
        open={moveOutOpen}
        onClose={() => setMoveOutOpen(false)}
        tenantId={tenant.id}
        hostelId={tenant.hostelId}
        tenantName={tenant.name}
        roomNo={tenant.room}
      />
      <CreateChargeSheet
        open={createChargeOpen}
        onClose={() => setCreateChargeOpen(false)}
        tenantId={tenant.id}
        tenantName={tenant.name}
        hostelId={tenant.hostelId}
      />
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
      <AmendAgreementSheet
        open={amendAgreementOpen}
        onClose={() => setAmendAgreementOpen(false)}
        tenant={tenant}
        onChangeRent={() => setChangeRentOpen(true)}
      />
      <ChangeRoomSheet
        open={changeRoomOpen}
        onClose={() => setChangeRoomOpen(false)}
        tenantId={tenant.id}
        tenantName={tenant.name}
        hostelId={tenant.hostelId}
        currentRoomId={tenant.currentRoomId}
        currentRoomNo={tenant.room}
        currentRent={tenant.stay.monthlyRent}
      />
      <DocumentPreviewSheet
        open={previewDoc != null}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.title ?? ''}
        url={previewDoc?.url ?? null}
        fileName={previewDoc?.fileName ?? 'document'}
      >
        {previewDoc?.doc && <DocumentThread tenantId={tenant.id} doc={previewDoc.doc} />}
      </DocumentPreviewSheet>
      {correctingPaymentId && (
        <CorrectPaymentModal
          paymentId={correctingPaymentId}
          hostelId={tenant.hostelId}
          tenantId={tenant.id}
          onClose={() => setCorrectingPaymentId(null)}
          onSuccessReverse={() => {
            // Reverse the wrong entry, then land straight in the flow that
            // records the right one — the loop the deleted page closed too.
            queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
            setTimeout(() => setQuickCollectOpen(true), 400);
          }}
        />
      )}
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

function StayRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-display text-[13px] font-bold text-foreground">{value}</span>
    </div>
  );
}
