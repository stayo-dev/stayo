export type TenantStatus =
  | 'INVITED'
  | 'ACTIVE'
  | 'MOVE_OUT_REQUESTED'
  | 'LEFT'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FORMER_TENANT';

export interface NormalizedTenant {
  id: string;
  profileId: string | null;
  name: string;
  email: string | null;
  phone: string;
  rollNumber: string;
  yearOfStudy: number | null;
  room: string;
  roomId: string | null;
  floor: string;
  status: TenantStatus | string;
  rent: number;
  joinDate: string | null;
  paymentSummary: Record<string, unknown>;
  outstandingAmount: number;
  paymentStatus: string;
  dueDate: string | null;
  obligationId: string | null;
  photoUrl: string | null;
  isProfileCompleted: boolean;
  documentVerified: boolean;
  hostelName: string | null;
  lastPaymentDate: string | null;
  overdueDays: number;
  hasAgreement: boolean;
  depositStatus: string;
  securityDeposit: number;
  guardianPhone: string | null;
  advanceBalance: number;
  /** `SELF_SERVE` (default) or `OWNER_MANAGED` — the tenant has no app login yet. */
  accessMode: string | null;
  /** `PENDING` | `ACCEPTED` | `NOT_REQUIRED` (legacy). Whether the tenant has personally accepted (ADR-165). */
  acceptanceStatus: string | null;
  /** When the tenant personally accepted, ISO string; null while pending. */
  acceptedAt: string | null;
  raw: Record<string, unknown>;
}

function activeAllocation(tenant: Record<string, unknown>) {
  const allocations = (tenant.room_allocations ?? tenant.allocations) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(allocations)) return null;
  return (
    allocations.find((a) => a.is_active === true && (a.end_date == null || a.end_date === undefined)) ??
    allocations[0] ??
    null
  );
}

export function normalizeTenant(s: Record<string, unknown>): NormalizedTenant {
  const profile = (s.profiles ?? s.profile) as Record<string, unknown> | undefined;
  const tenant = (s.tenant ?? {}) as Record<string, unknown>;
  const alloc = activeAllocation(s);
  const room = alloc?.room as Record<string, unknown> | undefined;
  const summary = (s.payment_summary ?? {}) as Record<string, unknown>;

  return {
    id: String(s.id ?? ''),
    profileId: s.profile_id != null ? String(s.profile_id) : null,
    name: String(profile?.name ?? s.name ?? 'Unknown'),
    email: profile?.email != null ? String(profile.email) : s.email != null ? String(s.email) : null,
    phone: String(profile?.phone ?? s.phone ?? s.phone_1 ?? 'N/A'),
    rollNumber: String(s.roll_number ?? 'N/A'),
    yearOfStudy: s.year_of_study != null ? Number(s.year_of_study) : null,
    room: room?.room_no != null ? String(room.room_no) : s.room_no != null ? String(s.room_no) : 'N/A',
    roomId: alloc?.room_id != null ? String(alloc.room_id) : null,
    floor: room?.floor != null ? String(room.floor) : 'N/A',
    status: String(s.status ?? 'INVITED'),
    rent: Number(s.monthly_rent ?? s.rent ?? 0),
    joinDate: s.joined_on != null ? String(s.joined_on) : null,
    paymentSummary: summary,
    outstandingAmount: Number(s.outstanding_amount ?? summary.pending_amount ?? 0),
    paymentStatus: String(s.payment_status ?? summary.payment_status ?? 'UNKNOWN'),
    dueDate: s.due_date != null ? String(s.due_date) : null,
    obligationId: s.obligation_id != null ? String(s.obligation_id) : null,
    photoUrl: s.photo_url != null ? String(s.photo_url) : tenant.photo_url != null ? String(tenant.photo_url) : null,
    isProfileCompleted: Boolean(profile?.is_profile_completed ?? s.is_profile_completed),
    documentVerified: Boolean(s.document_verified ?? profile?.document_verified),
    hostelName: s.hostel_name != null ? String(s.hostel_name) : null,
    lastPaymentDate: s.last_payment_date != null ? String(s.last_payment_date) : null,
    overdueDays: s.overdue_days != null ? Number(s.overdue_days) : 0,
    hasAgreement: Boolean(s.has_agreement),
    depositStatus: String(s.deposit_status ?? 'UNKNOWN'),
    securityDeposit: Number(s.security_deposit ?? s.advance_deposit ?? 0),
    guardianPhone: s.phone_2 != null ? String(s.phone_2) : s.guardian_phone != null ? String(s.guardian_phone) : profile?.emergency_contact != null ? String(profile.emergency_contact) : null,
    advanceBalance: Number(s.advance_balance ?? s.deposit_balance ?? 0),
    accessMode: s.access_mode != null ? String(s.access_mode) : null,
    acceptanceStatus: s.acceptance_status != null ? String(s.acceptance_status) : null,
    acceptedAt: s.tenant_accepted_at != null ? String(s.tenant_accepted_at) : null,
    raw: s,
  };
}

export function normalizeTenants(tenantsResponse: unknown): NormalizedTenant[] {
  if (!tenantsResponse) return [];
  const list = Array.isArray(tenantsResponse)
    ? tenantsResponse
    : Array.isArray((tenantsResponse as Record<string, unknown>).tenants)
      ? ((tenantsResponse as Record<string, unknown>).tenants as Record<string, unknown>[])
      : [];
  return list.map(normalizeTenant);
}

export function getInitials(name: string): string {
  return name
    ? name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : '??';
}

export const INACTIVE_STATUSES = ['LEFT', 'CANCELLED', 'EXPIRED', 'FORMER_TENANT'] as const;
