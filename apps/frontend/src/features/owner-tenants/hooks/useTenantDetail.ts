import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { tenantService } from '@features/tenants/api';
import { getInitials } from '@features/tenants/utils/normalize';
import type { TenantObligation, TenantActivityItem, MockGuardian } from '@shared/mocks/tenants';
import { documentTypeLabel, toReviewDocument, type ReviewDocument } from '../documents/kycDocuments';
import { groupPaymentSchedule, describeNextPayment, type PaymentSchedule, type NextPaymentLabel } from '../profile/paymentSchedule';

/**
 * A tenant document in a shape the review UI can act on — not just display.
 * `download_url` and the rejection thread used to be dropped here, which is
 * why the Documents tab could only render a status pill.
 */
export type RealTenantDocument = ReviewDocument & {
  title: string;
  sub: string;
};

/**
 * The live invitation behind an INVITED tenant, as normalized by the backend's
 * `invitation` block on the overview response. Carries no activation token —
 * `activationLink` is the only shareable form of it.
 */
export interface RealTenantInvitation {
  id: string;
  status: string;
  activationLink: string;
  sentAt: string | null;
  expiresAt: string | null;
  openedAt: string | null;
  activationStartedAt: string | null;
  reservationExpiresAt: string | null;
  email: string;
  revision: number;
  reservedRoom: { id: string; roomNo: string; floor: string | null } | null;
  agreementDurationMonths: number | null;
  agreementStartDate: string | null;
}

/** The tenant's live agreement, as the owner may view it. */
export interface RealTenantAgreement {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number | null;
  contractRent: number | null;
  contractDeposit: number | null;
  pdfUrl: string | null;
}

export interface RealTenantDetail {
  id: string;
  hostelId: string;
  name: string;
  initials: string;
  /** Uploaded during onboarding. Present on the response all along, never rendered. */
  photoUrl: string | null;
  phone: string;
  status: 'active' | 'dues' | 'overdue' | 'invited' | 'pending-docs';
  statusLabel: string;
  /**
   * `OWNER_MANAGED` means the tenant has not taken charge of their account yet
   * — the owner is keeping their records. It is NOT a lesser kind of tenancy:
   * rent generates, reminders fire and payments are recorded exactly the same.
   * Since inviting now makes a tenancy immediately ACTIVE, this — not
   * `status === 'invited'` — is how "hasn't activated yet" is known.
   */
  accessMode: 'SELF_SERVE' | 'OWNER_MANAGED' | null;
  /** `PENDING` | `ACCEPTED` | `NOT_REQUIRED` (legacy) — has the tenant personally accepted (ADR-165). */
  acceptanceStatus: 'PENDING' | 'ACCEPTED' | 'NOT_REQUIRED' | null;
  room: string;
  joinedDate: string;
  hostelName: string;
  guardian?: MockGuardian;
  outstanding: number;
  /** From FinancialReadModelService — the authority on *whether* they're overdue. */
  overdueAmount: number;
  currentPayableAmount: number;
  /** Rent paid ahead. Computed by the backend, previously dropped on the floor. */
  futureCredit: number;
  obligations: TenantObligation[];
  /** Raw due date + status per obligation, so days-overdue is derivable. */
  obligationDueDates: Array<{ due_date: string | null; status: string }>;
  /** Overdue / Upcoming / Paid split + projected next payment, from the shared billing-timeline read model. */
  paymentSchedule: PaymentSchedule;
  /** Formatted "next payment" for the header — accurate even when no obligation row exists yet. */
  nextPayment: NextPaymentLabel;
  /**
   * `type` is carried alongside the display fields so a payment row can offer
   * the correction flow. For `type: 'payment'` the item's `id` **is** the
   * payment id — see `recent_activity` in `getOwnerTenantOverview`.
   */
  activity: Array<TenantActivityItem & { type: string }>;
  documents: RealTenantDocument[];
  agreement: RealTenantAgreement | null;
  /** Needed by any room-scoped action; without it the room picker can't exclude the current room. */
  currentRoomId: string | null;
  /** True while a move-out is in flight, so the profile can say so. */
  hasOpenMoveOut: boolean;
  /**
   * The unmapped overview response. `contactChannels` reads the several
   * columns that can carry a phone number directly rather than having this
   * interface grow a field per column.
   */
  raw: Record<string, any>;
  /** Present only while the tenant is still INVITED. */
  invitation?: RealTenantInvitation;
  /** Raw maintenance terms — needed to show one consistent move-in total. */
  maintenanceCharge: number;
  maintenanceType: 'MONTHLY' | 'ONE_TIME' | 'NONE';
  email: string;
  stay: {
    hostelName: string;
    roomBed: string;
    moveInDate: string;
    agreementPeriod: string;
    monthlyRent: number;
    deposit: number;
    billingFrequency: string;
  };
}

function activityTone(type: string): TenantActivityItem['tone'] {
  if (type === 'payment') return 'positive';
  if (type === 'reminder' || type === 'moveout') return 'negative';
  return 'neutral';
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Real Tenant Detail data — composes: owner/tenants/:id/overview
 * (header/guardian/stay/activity/financial scalars + `read_model_items`),
 * :id/documents (verification status), :id/billing-timeline (the full
 * obligation/payment schedule — same read model the tenant portal uses; drives
 * the Payments tab + "Next payment"), and :id/full (kept only as a fallback for
 * the obligation list if billing-timeline fails).
 */
export function useTenantDetail(tenantId: string | undefined) {
  const session = useOwnerSession();

  const query = useQuery({
    queryKey: ['owner', 'tenant', tenantId, 'detail'],
    queryFn: async () => {
      const [overview, documentsResult, full, billingTimeline] = await Promise.all([
        tenantService.getOwnerTenantOverview(tenantId!),
        tenantService.getDocuments(tenantId!).catch(() => ({ documents: [], required_documents: [] })),
        tenantService.getFull(tenantId!).catch(() => null),
        // The rich obligation/payment schedule — same read model the tenant
        // portal uses. `getFull` (capped at 5, no status/payment detail) is
        // kept only as a fallback while this rolls out.
        tenantService.getTenantBillingTimeline(tenantId!).catch(() => null),
      ]);
      return { overview, documentsResult, full, billingTimeline };
    },
    enabled: Boolean(tenantId) && session.isAuthenticated,
    staleTime: 30_000,
    retry: false,
  });

  let tenant: RealTenantDetail | undefined;

  if (query.data?.overview) {
    const { overview, documentsResult, full, billingTimeline } = query.data;
    const o = overview as Record<string, any>;

    const outstanding = Number(o.outstanding ?? o.financial_summary?.outstanding ?? 0);
    // `overdue_amount` (from FinancialReadModelService) is the authority on
    // whether the tenant is genuinely PAST due — `outstanding` also counts
    // upcoming, not-yet-due obligations, so keying the pill on it labelled a
    // tenant "Overdue" the moment this month's rent was generated.
    const overdueAmount = Number(o.overdue_amount ?? 0);
    const isInvited = String(o.status ?? '').toUpperCase() === 'INVITED';
    const documentVerified = Boolean(o.document_verified ?? o.compliance?.document_verification_status === 'VERIFIED');
    let status: RealTenantDetail['status'];
    let statusLabel: string;
    if (isInvited) {
      status = 'invited';
      statusLabel = 'Invited';
    } else if (overdueAmount > 0) {
      status = 'overdue';
      statusLabel = 'Overdue';
    } else if (outstanding > 0) {
      status = 'dues';
      statusLabel = 'Payment Due';
    } else if (!documentVerified) {
      status = 'pending-docs';
      statusLabel = 'Docs Pending';
    } else {
      status = 'active';
      statusLabel = 'Active';
    }

    const guardian: MockGuardian | undefined = o.guardian_name
      ? { name: String(o.guardian_name), relation: String(o.guardian_relation || 'Guardian'), phone: String(o.guardian_phone || '') }
      : undefined;

    const activity: Array<TenantActivityItem & { type: string }> = Array.isArray(o.recent_activity)
      ? o.recent_activity.map((a: any) => ({
          id: String(a.id),
          type: String(a.type ?? ''),
          title: String(a.title ?? ''),
          sub: String(a.detail ?? ''),
          date: formatDate(a.date),
          tone: activityTone(String(a.type ?? '')),
        }))
      : [];

    const presentDocs = Array.isArray(documentsResult?.documents) ? documentsResult.documents : [];
    const requiredTypes: string[] = Array.isArray(documentsResult?.required_documents) ? documentsResult.required_documents : [];
    const presentTypes = new Set(presentDocs.map((d: any) => String(d.doc_type)));
    const documents: RealTenantDocument[] = [
      ...presentDocs.map((d: any) => {
        const reviewed = toReviewDocument(d);
        return {
          ...reviewed,
          title: documentTypeLabel(reviewed.docType),
          sub: reviewed.latestRejectionReason ?? formatDate(d.created_at),
        };
      }),
      ...requiredTypes
        .filter((t) => !presentTypes.has(t))
        .map((t) => ({
          id: `missing-${t}`,
          docType: t,
          status: 'MISSING' as const,
          isActive: false,
          downloadUrl: null,
          latestRejectionReason: null,
          thread: [],
          uploadedAt: null,
          title: `${documentTypeLabel(t)} (required)`,
          sub: 'Not uploaded yet',
        })),
    ];

    // Prefer the billing-timeline read model (rich per-obligation rows incl.
    // paid date, method and billing period, and a projected next installment);
    // fall back to the capped `/full` list if the timeline call failed.
    const timelineItems: any[] = Array.isArray(billingTimeline?.items) ? billingTimeline.items : [];
    const nextRentGeneration = billingTimeline?.next_rent_generation ?? null;
    const paymentSchedule = groupPaymentSchedule(timelineItems, nextRentGeneration, new Date());
    const scheduleRows: any[] = [
      ...paymentSchedule.overdue,
      ...paymentSchedule.upcoming,
      ...paymentSchedule.paid,
    ];

    const fallbackObligations: any[] = Array.isArray(full?.rent_obligations) ? full.rent_obligations : [];
    const usingTimeline = scheduleRows.length > 0 || timelineItems.length > 0;

    const obligations: TenantObligation[] = usingTimeline
      ? scheduleRows.map((row) => ({
          id: String(row.id),
          type: row.type,
          month: row.billingPeriodLabel || '',
          amount: Number(row.amount ?? 0),
          dueLabel: `Due: ${formatDate(row.dueDate)}`,
          status: (['PENDING', 'UPCOMING', 'PAID', 'OVERDUE'].includes(String(row.state).toUpperCase())
            ? String(row.state).toUpperCase()
            : row.state === 'paid' ? 'PAID' : row.state === 'overdue' ? 'OVERDUE' : row.state === 'upcoming' ? 'UPCOMING' : 'PENDING'
          ) as TenantObligation['status'],
        }))
      : fallbackObligations.map((ob: any) => ({
          id: String(ob.id),
          type: String(ob.obligation_type ?? 'RENT'),
          month: formatDate(ob.rent_month) || String(ob.rent_month ?? ''),
          amount: Number(ob.total_amount ?? ob.amount ?? 0),
          dueLabel: `Due: ${formatDate(ob.due_date)}`,
          status: (['PENDING', 'UPCOMING', 'PAID', 'OVERDUE'].includes(ob.status) ? ob.status : 'PENDING') as TenantObligation['status'],
        }));

    /**
     * Unformatted { due_date, status } pairs — the OVERDUE tile and the
     * next-payment logic count real days from these. Sourced from the full
     * timeline (not the capped 5) so "Nothing due" only shows when the tenant
     * genuinely owes nothing.
     */
    const obligationDueDates = usingTimeline
      ? scheduleRows.map((row) => ({
          due_date: row.dueDate ? String(row.dueDate) : null,
          status: row.state === 'paid' ? 'PAID' : row.state === 'overdue' ? 'OVERDUE' : row.state === 'waived' ? 'WAIVED' : 'PENDING',
        }))
      : fallbackObligations.map((ob: any) => ({
          due_date: ob.due_date ? String(ob.due_date) : null,
          status: String(ob.status ?? 'PENDING'),
        }));

    const inv = (o.invitation ?? null) as Record<string, any> | null;

    // `hostel_id` is now returned by the overview endpoint. The invitation's
    // own hostel is kept as a fallback because every hostel-scoped editor
    // (room list, pricing defaults) is dead without a hostel id — that was the
    // cause of the invited-tenant edit form opening completely blank.
    const hostelId = String(o.hostel_id ?? o.tenant?.hostel_id ?? inv?.hostel_id ?? '');
    const hostelName = session.hostels.find((h) => h.id === hostelId)?.name || (o.current_room ? 'This hostel' : '—');

    /**
     * An INVITED tenant has no `room_allocation` — the bed is held by a
     * reservation until they activate. Reading the room from allocations alone
     * made every invited tenant look room-less and permanently "incomplete".
     */
    const reservedRoomNo = inv?.reserved_room?.room_no ? String(inv.reserved_room.room_no) : '';
    const roomLabel = o.current_room
      ? String(o.current_room.room_no)
      : reservedRoomNo || (o.room_number ? String(o.room_number) : '—');

    const invitation: RealTenantInvitation | undefined = inv
      ? {
          id: String(inv.id),
          status: String(inv.status ?? 'PENDING'),
          activationLink: String(inv.activation_link ?? ''),
          sentAt: inv.sent_at ? String(inv.sent_at) : null,
          expiresAt: inv.expires_at ? String(inv.expires_at) : null,
          openedAt: inv.opened_at ? String(inv.opened_at) : null,
          activationStartedAt: inv.activation_started_at ? String(inv.activation_started_at) : null,
          reservationExpiresAt: inv.reservation_expires_at ? String(inv.reservation_expires_at) : null,
          email: String(inv.email ?? ''),
          revision: Number(inv.revision ?? 1),
          reservedRoom: inv.reserved_room
            ? {
                id: String(inv.reserved_room.id),
                roomNo: String(inv.reserved_room.room_no),
                floor: inv.reserved_room.floor ? String(inv.reserved_room.floor) : null,
              }
            : null,
          agreementDurationMonths: inv.agreement_duration_months ? Number(inv.agreement_duration_months) : null,
          agreementStartDate: inv.agreement_start_date ? String(inv.agreement_start_date) : null,
        }
      : undefined;

    const agreementRaw = (o.current_agreement ?? null) as Record<string, any> | null;
    const profileRaw = (o.profile ?? {}) as Record<string, any>;
    const tenantRaw = (o.tenant ?? {}) as Record<string, any>;

    const str = (value: unknown) => (value == null ? '' : String(value));

    tenant = {
      id: String(o.id ?? tenantId),
      hostelId,
      name: String(o.name ?? 'Tenant'),
      initials: getInitials(String(o.name ?? '')),
      photoUrl: o.photo_url ? String(o.photo_url) : tenantRaw.photo_url ? String(tenantRaw.photo_url) : null,
      phone: String(o.phone ?? ''),
      status,
      statusLabel,
      accessMode:
        o.access_mode === 'OWNER_MANAGED' || o.access_mode === 'SELF_SERVE'
          ? o.access_mode
          : tenantRaw.access_mode === 'OWNER_MANAGED' || tenantRaw.access_mode === 'SELF_SERVE'
            ? tenantRaw.access_mode
            : null,
      acceptanceStatus: ((): 'PENDING' | 'ACCEPTED' | 'NOT_REQUIRED' | null => {
        const raw = String(o.acceptance_status ?? tenantRaw.acceptance_status ?? '').toUpperCase();
        return raw === 'PENDING' || raw === 'ACCEPTED' || raw === 'NOT_REQUIRED' ? raw : null;
      })(),
      room: roomLabel,
      joinedDate: formatDate(o.joined_on ?? o.joined_at),
      hostelName,
      guardian,
      outstanding,
      overdueAmount,
      currentPayableAmount: Number(o.current_payable_amount ?? 0),
      futureCredit: Number(o.advance_balance ?? 0),
      obligations,
      obligationDueDates,
      paymentSchedule,
      nextPayment: describeNextPayment(paymentSchedule.next, new Date()),
      activity,
      documents,
      agreement: agreementRaw
        ? {
            id: String(agreementRaw.id),
            status: String(agreementRaw.status ?? ''),
            startDate: agreementRaw.agreement_start_date ? String(agreementRaw.agreement_start_date) : null,
            endDate: agreementRaw.agreement_end_date ? String(agreementRaw.agreement_end_date) : null,
            durationMonths: agreementRaw.agreement_duration_months != null ? Number(agreementRaw.agreement_duration_months) : null,
            contractRent: agreementRaw.contract_rent != null ? Number(agreementRaw.contract_rent) : null,
            contractDeposit: agreementRaw.contract_security_deposit != null ? Number(agreementRaw.contract_security_deposit) : null,
            pdfUrl: agreementRaw.pdf_url ? String(agreementRaw.pdf_url) : null,
          }
        : null,
      currentRoomId: o.current_room?.id ? String(o.current_room.id) : null,
      hasOpenMoveOut: Array.isArray(o.move_out_requests) && o.move_out_requests.length > 0,
      raw: o,
      invitation,
      maintenanceCharge: Number(o.maintenance_charge ?? 0),
      maintenanceType: (['MONTHLY', 'ONE_TIME', 'NONE'].includes(String(o.maintenance_type))
        ? String(o.maintenance_type)
        : 'NONE') as RealTenantDetail['maintenanceType'],
      email: String(o.email ?? ''),
      stay: {
        hostelName,
        roomBed: roomLabel,
        moveInDate: formatDate(o.joined_on ?? o.joined_at),
        agreementPeriod: o.current_agreement
          ? `${formatDate(o.current_agreement.agreement_start_date)} – ${formatDate(o.current_agreement.agreement_end_date)}`
          : o.agreement_duration_months
            ? `${o.agreement_duration_months} months`
            : '—',
        monthlyRent: Number(o.monthly_rent ?? o.rent ?? 0),
        deposit: Number(o.security_deposit ?? o.advance_deposit ?? 0),
        billingFrequency: String(o.payment_frequency ?? 'MONTHLY'),
      },
    };
  }

  return { tenant, isLoading: query.isLoading, isError: query.isError, error: query.error };
}
