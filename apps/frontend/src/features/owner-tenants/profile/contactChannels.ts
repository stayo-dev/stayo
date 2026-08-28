/**
 * Who the owner can reach on a tenant profile, and which controls each row
 * genuinely offers.
 *
 * The Communication Center used to render four fixed icons as `<span>`s with
 * no handlers — including one (a document icon) that mapped to no action at
 * all. Deciding the channels here means a control can only be rendered for a
 * number that actually exists, and the row set can't silently drift from the
 * data the overview endpoint returns.
 *
 * The emergency contact is **optional**: two different columns can carry it,
 * they can disagree, and its absence is a valid state — never a warning.
 */

export type ContactChannel = 'call' | 'whatsapp' | 'copy';

export type ContactKind = 'tenant' | 'guardian' | 'emergency';

export interface ContactRow {
  kind: ContactKind;
  label: string;
  name: string;
  relation?: string;
  phone: string;
  /** Only ever true for the tenant's own number — nothing verifies the others. */
  verified: boolean;
  channels: ContactChannel[];
}

const PHONE_CHANNELS: ContactChannel[] = ['call', 'whatsapp', 'copy'];

/**
 * `"N/A"` is a real value in this data, written by older import paths, and
 * `useTenantActions` already refuses to dial it. Treating it as a number here
 * would render three buttons that all warn instead of acting.
 */
function usablePhone(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.toUpperCase() === 'N/A') return '';
  return text;
}

/** Compares numbers by digits alone, so spacing and punctuation can't defeat deduplication. */
function sameNumber(a: string, b: string): boolean {
  const digits = (v: string) => v.replace(/\D/g, '');
  const left = digits(a);
  const right = digits(b);
  return left.length > 0 && left === right;
}

function row(
  kind: ContactKind,
  label: string,
  name: string,
  phone: string,
  extras: { relation?: string; verified?: boolean } = {},
): ContactRow {
  return {
    kind,
    label,
    name,
    phone,
    verified: extras.verified ?? false,
    channels: phone ? [...PHONE_CHANNELS] : [],
    ...(extras.relation ? { relation: extras.relation } : {}),
  };
}

/**
 * Builds the contact rows for one tenant from the owner overview response.
 *
 * Order is fixed — tenant, guardian, emergency — because it reflects who the
 * owner should try first.
 */
export function toContactRows(overview: Record<string, any>): ContactRow[] {
  const profile = (overview?.profile ?? {}) as Record<string, any>;

  const tenantPhone = usablePhone(overview?.phone ?? profile.phone);
  const rows: ContactRow[] = [
    row('tenant', 'Tenant', String(overview?.name || '').trim() || 'Tenant', tenantPhone, {
      verified: profile.phone_verified === true,
    }),
  ];

  const guardianPhone = usablePhone(overview?.guardian_phone);
  if (guardianPhone) {
    rows.push(
      row(
        'guardian',
        'Guardian',
        String(overview?.guardian_name || '').trim() || 'Guardian',
        guardianPhone,
        { relation: String(overview?.guardian_relation || '').trim() || undefined },
      ),
    );
  }

  // Optional by design. `phone_3` wins over the profile's copy because it is
  // the tenant-scoped column the owner-side forms write.
  const emergencyPhone =
    usablePhone(overview?.phone_3) || usablePhone(profile.emergency_contact);
  const duplicatesExisting = rows.some((r) => sameNumber(r.phone, emergencyPhone));
  if (emergencyPhone && !duplicatesExisting) {
    rows.push(
      row(
        'emergency',
        'Emergency contact',
        String(overview?.emergency_contact_name || '').trim() || 'Emergency contact',
        emergencyPhone,
        { relation: String(overview?.emergency_contact_relation || '').trim() || undefined },
      ),
    );
  }

  return rows;
}
