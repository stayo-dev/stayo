import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { tenantService } from '@features/tenants/api';
import { getInitials } from '@features/tenants/utils/normalize';
import type { TenantObligation, TenantActivityItem, MockGuardian } from '@shared/mocks/tenants';
import { documentTypeLabel, toReviewDocument, type ReviewDocument } from '../documents/kycDocuments';

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

export interface RealTenantDetail {
  id: string;
  hostelId: string;
  name: string;
  initials: string;
  phone: string;
  status: 'active' | 'overdue' | 'invited' | 'pending-docs';
  statusLabel: string;
  room: string;
  joinedDate: string;
  hostelName: string;
  agreementStatus: string;
  guardian?: MockGuardian;
  riskScore: number;
  riskLabel: string;
  riskInsight: string;
  riskTrend: string;
  kycStatus: string;
  outstanding: number;
  overdueMonths: number;
  obligations: TenantObligation[];
  activity: TenantActivityItem[];
  documents: RealTenantDocument[];
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

const GRADE_LABEL: Record<string, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
  NEEDS_ATTENTION: 'Needs Attention',
  HIGH_RISK: 'High Risk',
};

const TREND_LABEL: Record<string, string> = {
  IMPROVING: 'Improving',
  STABLE: 'Stable',
  DECLINING: 'Declining',
};

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
 * Real Tenant Detail data — composes the 4 endpoints found to matter during
 * planning research: owner/tenants/:id/overview (header/guardian/stay/
 * activity), :id/score (real risk score, replacing the mock's fabricated
 * one), :id/documents (real verification status), :id/full (rent_obligations,
 * capped at 5 by the backend — no fuller history endpoint exists).
 */
export function useTenantDetail(tenantId: string | undefined) {
  const session = useOwnerSession();

  const query = useQuery({
    queryKey: ['owner', 'tenant', tenantId, 'detail'],
    queryFn: async () => {
      const [overview, score, documentsResult, full] = await Promise.all([
        tenantService.getOwnerTenantOverview(tenantId!),
        tenantService.getTenantScore(tenantId!).catch(() => null),
        tenantService.getDocuments(tenantId!).catch(() => ({ documents: [], required_documents: [] })),
        tenantService.getFull(tenantId!).catch(() => null),
      ]);
      return { overview, score, documentsResult, full };
    },
    enabled: Boolean(tenantId) && session.isAuthenticated,
    staleTime: 30_000,
    retry: false,
  });

  let tenant: RealTenantDetail | undefined;

  if (query.data?.overview) {
    const { overview, score, documentsResult, full } = query.data;
    const o = overview as Record<string, any>;

    const outstanding = Number(o.outstanding ?? o.financial_summary?.outstanding ?? 0);
    const isInvited = String(o.status ?? '').toUpperCase() === 'INVITED';
    const documentVerified = Boolean(o.document_verified ?? o.compliance?.document_verification_status === 'VERIFIED');
    let status: RealTenantDetail['status'];
    let statusLabel: string;
    if (isInvited) {
      status = 'invited';
      statusLabel = 'Invited';
    } else if (outstanding > 0) {
      status = 'overdue';
      statusLabel = 'Overdue';
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

    const grade = score?.grade ? String(score.grade) : '';
    const activity: TenantActivityItem[] = Array.isArray(o.recent_activity)
      ? o.recent_activity.map((a: any) => ({
          id: String(a.id),
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

    const obligations: TenantObligation[] = Array.isArray(full?.rent_obligations)
      ? full.rent_obligations.map((ob: any) => ({
          id: String(ob.id),
          type: String(ob.obligation_type ?? 'RENT'),
          month: formatDate(ob.rent_month) || String(ob.rent_month ?? ''),
          amount: Number(ob.total_amount ?? ob.amount ?? 0),
          dueLabel: `Due: ${formatDate(ob.due_date)}`,
          status: (['PENDING', 'UPCOMING', 'PAID', 'OVERDUE'].includes(ob.status) ? ob.status : 'PENDING') as TenantObligation['status'],
        }))
      : [];

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

    tenant = {
      id: String(o.id ?? tenantId),
      hostelId,
      name: String(o.name ?? 'Tenant'),
      initials: getInitials(String(o.name ?? '')),
      phone: String(o.phone ?? ''),
      status,
      statusLabel,
      room: roomLabel,
      joinedDate: formatDate(o.joined_on ?? o.joined_at),
      hostelName,
      agreementStatus: o.has_active_agreement ? 'Signed' : 'Pending',
      guardian,
      riskScore: Number(score?.score ?? 0),
      riskLabel: GRADE_LABEL[grade] ?? '—',
      riskInsight: score?.insights?.[0] ?? score?.suggestions?.[0] ?? 'No insights yet.',
      riskTrend: TREND_LABEL[String(score?.trend ?? '')] ?? '—',
      kycStatus: documentVerified ? 'Verified' : 'Pending',
      outstanding,
      overdueMonths: Number(o.overdue_amount ?? 0) > 0 ? 1 : 0,
      obligations,
      activity,
      documents,
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
