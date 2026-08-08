/**
 * Turns the backend's tenancy-eligibility refusal into what the owner reads.
 *
 * A person can hold only one tenancy at a time, so inviting someone who already
 * lives somewhere fails with a 409. How much that refusal may say depends on who
 * owns the hostel they're in: the inviting owner may see their *own* hostel named,
 * but never another owner's — that would hand a competitor's tenant roster, and a
 * person's address, to whoever types the right email.
 *
 * Pure so it can be tested without a DOM (this app's test runner is node-only).
 */

export type TenancyConflictCode = 'TENANT_HAS_ACTIVE_TENANCY' | 'PREVIOUS_TENANCY_NOT_SETTLED';

export interface TenancyDisclosure {
  scope: 'OWN' | 'OTHER';
  hostelName: string | null;
  roomNumber: string | null;
  tenantId: string | null;
}

export interface TenancyConflict {
  code: TenancyConflictCode;
  title: string;
  body: string;
  /** Tenant to link to, when they are one of this owner's own. */
  tenantId: string | null;
}

const CONFLICT_CODES: TenancyConflictCode[] = [
  'TENANT_HAS_ACTIVE_TENANCY',
  'PREVIOUS_TENANCY_NOT_SETTLED',
];

/**
 * Reads an Axios error. Returns null when it isn't a tenancy conflict, so the
 * caller falls back to its normal error banner.
 */
export function parseTenancyConflict(error: unknown): TenancyConflict | null {
  const payload = (error as any)?.response?.data?.error;
  const code = payload?.code as TenancyConflictCode | undefined;
  if (!code || !CONFLICT_CODES.includes(code)) return null;

  const disclosure = (payload.details ?? {}) as Partial<TenancyDisclosure>;
  const isOwn = disclosure.scope === 'OWN';
  const hostelName = isOwn ? disclosure.hostelName ?? null : null;
  const roomNumber = isOwn ? disclosure.roomNumber ?? null : null;

  const where = hostelName
    ? roomNumber
      ? `${hostelName}, room ${roomNumber}`
      : hostelName
    : null;

  if (code === 'TENANT_HAS_ACTIVE_TENANCY') {
    return {
      code,
      title: 'Already a tenant',
      body: where
        ? `This person is already a tenant of yours at ${where}. You can open their profile from your tenant list.`
        : 'This person is currently a tenant at another property on Stayo. They can only join once they have moved out and their settlement is complete — you may want to contact them directly.',
      tenantId: isOwn ? disclosure.tenantId ?? null : null,
    };
  }

  return {
    code,
    title: 'Previous stay not settled',
    body: where
      ? `This person's previous stay at ${where} has not been settled. Complete their move-out settlement and you can invite them again.`
      : 'This person has left another property on Stayo but their move-out is not settled yet. They can be invited once that is complete.',
    tenantId: isOwn ? disclosure.tenantId ?? null : null,
  };
}
