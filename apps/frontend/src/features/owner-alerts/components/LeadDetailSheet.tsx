import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Mail, MessageCircle, Phone } from 'lucide-react';

import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { admissionsService } from '@features/admissions/api';
import { queryKeys } from '@lib/queryKeys';
import { openWhatsAppShare } from '@lib/share';
import { HostelStaySummary } from '@features/owner-tenants/components/HostelStaySummary';
import { tenantHistoryService } from '@features/owner-tenants/api/tenantHistory';
import { classifyHostelRelationship } from '@features/owner-tenants/hostelRelationship';
import { LEAD_SOURCE_LABEL, leadStatusLabel, leadCanAcceptHoldReject } from '../leadConstants';

interface LeadDetailSheetProps {
  leadId: string | null;
  onClose: () => void;
}

type ActionMode = 'view' | 'hold' | 'reject-confirm';

const actionBtn = 'flex-1 rounded-[10px] bg-foreground py-2.5 text-center font-display text-[12.5px] font-bold text-background disabled:opacity-50';
const sideBtn = 'flex-1 rounded-[10px] border border-border bg-card py-2.5 text-center text-[12.5px] font-semibold text-foreground disabled:opacity-50';

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Full detail for one enquiry/lead — reached from the Alerts "Leads" tab.
 * Per the explicit "never mix old and new" instruction: the previous-stay
 * summary (if any) renders in its own card, fully separate from the "New
 * Enquiry" section below it. Fetches via the existing, already-complete
 * `admissionsService.detail()` — no new backend route.
 *
 * The Accept / Hold / Reject action row (footer) replaces the old "Follow
 * up" button, which used to live one level up in AlertsPage and did nothing
 * but open this sheet. All three call the same `admissionsService.updateStatus`
 * PATCH this sheet's own data query already used, and invalidate the shared
 * `queryKeys.admissions` prefix so both the Leads list and this sheet refresh.
 */
export function LeadDetailSheet({ leadId, onClose }: LeadDetailSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ActionMode>('view');
  const [holdMessage, setHoldMessage] = useState('');

  const { data: lead, isLoading } = useQuery({
    queryKey: queryKeys.admissions.detail(leadId as string),
    queryFn: () => admissionsService.detail(leadId),
    enabled: Boolean(leadId),
  });

  const hostelId = lead?.hostel_id;
  const profileId = lead?.seeker_profile_id;
  // Same query key HostelStaySummary uses internally below — React Query
  // dedupes identical keys, so this reads the same cached result rather than
  // firing a second request. Disclosure is already earned here via this
  // lead's own open enquiry (ADR-075) — this only classifies what's already
  // fetched, it discloses nothing new.
  const { data: staySummary } = useQuery({
    queryKey: queryKeys.owner.tenantHistoryByProfile(hostelId ?? '', profileId ?? ''),
    queryFn: () => tenantHistoryService.byProfile(hostelId as string, profileId as string),
    enabled: Boolean(hostelId && profileId),
  });
  const relationship = staySummary && hostelId ? classifyHostelRelationship(staySummary, hostelId) : null;
  const isActiveElsewhere = relationship?.relationship === 'ACTIVE_ELSEWHERE';

  const actionMutation = useMutation({
    mutationFn: (payload: { status: 'ON_HOLD' | 'REJECTED'; note?: string }) =>
      admissionsService.updateStatus(leadId as string, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all() });
      if (variables.status === 'ON_HOLD') {
        stayoToast.success('Enquiry put on hold');
        setMode('view');
        setHoldMessage('');
      } else {
        stayoToast.success('Enquiry rejected');
        setMode('view');
      }
    },
    onError: (error) => {
      stayoToast.error(getErrorMessage(error, 'Something went wrong. Please try again.'));
    },
  });

  /**
   * Accepting *is* inviting.
   *
   * This used to PATCH the lead to ACCEPTED and then open the Add Tenant
   * wizard, because the conversion endpoint refused anything else. Closing
   * that wizard without sending left the lead marked Accepted with no
   * invitation behind it — an owner reading their Leads tab saw enquiries
   * marked accepted that nobody had actually been invited to.
   *
   * Nothing is written here now. The lead advances to INVITED inside
   * `POST /leads/:id/convert-to-invitation`, when the invitation really goes
   * out; abandoning the wizard leaves the enquiry exactly as it was, still
   * waiting for a decision.
   */
  const goToAddTenant = () => {
    onClose();
    navigate(`/owner/tenants?fromLead=${leadId}`);
  };

  const closeAndReset = (open: boolean) => {
    if (!open) {
      setMode('view');
      setHoldMessage('');
      onClose();
    }
  };

  return (
    <BottomSheet
      open={Boolean(leadId)}
      onOpenChange={closeAndReset}
      title={lead?.student_name ?? 'Enquiry'}
      footer={
        !lead
          ? null
          : mode === 'hold'
            ? (
              <div className="flex flex-col gap-2.5">
                <div className="text-[13px] font-semibold text-foreground">Put enquiry on hold</div>
                <textarea
                  value={holdMessage}
                  onChange={(e) => setHoldMessage(e.target.value)}
                  placeholder="Enter a message/reason…"
                  rows={3}
                  disabled={actionMutation.isPending}
                  className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setMode('view'); setHoldMessage(''); }}
                    disabled={actionMutation.isPending}
                    className={sideBtn}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => actionMutation.mutate({ status: 'ON_HOLD', note: holdMessage.trim() })}
                    disabled={actionMutation.isPending || !holdMessage.trim()}
                    className={actionBtn}
                  >
                    {actionMutation.isPending ? 'Saving…' : 'Put on Hold'}
                  </button>
                </div>
              </div>
            )
            : mode === 'reject-confirm'
              ? (
                <div className="flex flex-col gap-2.5">
                  <div className="text-[13px] font-semibold text-foreground">Reject enquiry?</div>
                  <p className="text-[12px] text-muted-foreground">Are you sure you want to reject this enquiry?</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setMode('view')} disabled={actionMutation.isPending} className={sideBtn}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => actionMutation.mutate({ status: 'REJECTED' })}
                      disabled={actionMutation.isPending}
                      className={`${actionBtn} bg-destructive text-destructive-foreground`}
                    >
                      {actionMutation.isPending ? 'Rejecting…' : 'Reject'}
                    </button>
                  </div>
                </div>
              )
              : leadCanAcceptHoldReject(lead.status) && isActiveElsewhere
                ? (
                  <div className="flex gap-2">
                    {lead.student_phone ? (
                      <a href={`tel:${lead.student_phone}`} className={sideBtn}>
                        Call
                      </a>
                    ) : (
                      <button type="button" disabled className={sideBtn}>
                        Call
                      </button>
                    )}
                    {lead.student_phone ? (
                      <button
                        type="button"
                        onClick={() =>
                          openWhatsAppShare(
                            `Hi ${lead.student_name}, this is regarding your enquiry at ${lead.hostel?.name ?? 'our hostel'}.`,
                            lead.student_phone,
                          )
                        }
                        className={sideBtn}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                          Chat
                        </span>
                      </button>
                    ) : (
                      <button type="button" disabled className={sideBtn}>
                        Chat
                      </button>
                    )}
                    <button type="button" onClick={() => setMode('hold')} disabled={actionMutation.isPending} className={sideBtn}>
                      Hold
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('reject-confirm')}
                      disabled={actionMutation.isPending}
                      className={`${sideBtn} text-destructive`}
                    >
                      Reject
                    </button>
                  </div>
                )
                : leadCanAcceptHoldReject(lead.status)
                  ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={goToAddTenant}
                        disabled={actionMutation.isPending}
                        className={actionBtn}
                      >
                        Accept &amp; invite
                      </button>
                      <button type="button" onClick={() => setMode('hold')} disabled={actionMutation.isPending} className={sideBtn}>
                        Hold
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('reject-confirm')}
                        disabled={actionMutation.isPending}
                        className={`${sideBtn} text-destructive`}
                      >
                        Reject
                      </button>
                    </div>
                  )
                : lead.status === 'ACCEPTED'
                  ? (
                    <button type="button" onClick={goToAddTenant} className={actionBtn}>
                      Continue to Add Tenant
                    </button>
                  )
                  : (
                    <div className="py-1 text-center text-[12.5px] text-muted-foreground">
                      {lead.status === 'REJECTED' && 'This enquiry was rejected.'}
                      {(lead.status === 'INVITED' || lead.status === 'JOINED') && 'This enquiry has been converted to a tenant.'}
                      {lead.status === 'LOST' && 'This enquiry is marked as not proceeding.'}
                    </div>
                  )
      }
    >
      {isLoading || !lead ? (
        <div className="flex flex-col gap-3 py-2">
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          <div className="flex flex-col gap-1.5 text-[12.5px] text-muted-foreground">
            {lead.student_phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" strokeWidth={1.8} />
                {lead.student_phone}
              </span>
            )}
            {lead.student_email && (
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" strokeWidth={1.8} />
                {lead.student_email}
              </span>
            )}
          </div>

          {isActiveElsewhere && relationship?.stay && (
            <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-700">
              This person currently has an active tenancy at {relationship.stay.hostel.name ?? 'another hostel'}. Inviting them here isn&apos;t possible until they move out and settle there — Call or Chat to stay in touch.
            </p>
          )}

          {lead.seeker_profile_id && <HostelStaySummary hostelId={lead.hostel_id} profileId={lead.seeker_profile_id} />}

          <section className="rounded-2xl border border-border bg-card p-4">
            <h3 className="mb-2 font-display text-[15px] font-bold text-foreground">New Enquiry</h3>
            <dl className="flex flex-col gap-2 text-[12.5px]">
              <Row label="Status" value={leadStatusLabel(lead.status)} />
              <Row label="Source" value={`Enquired via ${LEAD_SOURCE_LABEL[lead.source] ?? lead.source} · ${lead.hostel?.name ?? ''}`} />
              <Row
                label="Received"
                value={
                  lead.first_visited_at
                    ? new Date(lead.first_visited_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'
                }
              />
              {lead.notes && (
                <div className="pt-1">
                  <dt className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Message</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-foreground">{lead.notes}</dd>
                </div>
              )}
              {Array.isArray(lead.notes_list) && lead.notes_list.length > 0 && (
                <div className="pt-1">
                  <dt className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Notes</dt>
                  <dd className="mt-1 flex flex-col gap-2">
                    {lead.notes_list.map((n: { id: string; note: string; created_at: string }) => (
                      <div key={n.id} className="rounded-lg bg-muted/60 px-2.5 py-2 text-foreground">
                        <div className="whitespace-pre-wrap">{n.note}</div>
                        <div className="mt-1 text-[10.5px] text-muted-foreground">
                          {new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      )}
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string | undefined | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold text-foreground">{value}</dd>
    </div>
  );
}
