/**
 * The values filled in for you on every invite.
 *
 * ## What belongs here, and what does not
 *
 * The invite wizard asks for twenty fields. Most are per-tenant and can never
 * be defaulted — name, phone, room, joining date, what they have already paid.
 * Exactly five repeat across every invite, and only three of those belong on
 * this screen:
 *
 * - **rent**, from the room's own price, when the hostel wants that
 * - **maintenance**, which had no editor anywhere despite being billed
 * - **agreement length**
 *
 * Deposit and billing cycle are the other two. They are deliberately *not*
 * here: they already have correct homes on the Deposits and Rent screens, and
 * a second editor for one value is how two screens start disagreeing about it.
 * The screen says where they come from instead.
 *
 * ## Why maintenance matters most
 *
 * `MAINTENANCE` obligations are generated and billed to tenants, and the
 * hostel-level default had no editor at all — so an owner typed the same
 * figure by hand on every invite. In admission season that is the same number
 * typed thirty times, and a number typed thirty times is a number eventually
 * typed wrong.
 */

/**
 * Mirrored from the backend's own validator (`invitation-service.ts` accepts
 * exactly MONTHLY, ONE_TIME or NONE), which stays the authority.
 *
 * MONTHLY is billed every month alongside rent; ONE_TIME is a single charge
 * at move-in — a fit-out or joining fee, not a recurring one. The difference
 * is the whole reason an owner needs to pick: the same ₹2,000 means ₹24,000 a
 * year or ₹2,000 once.
 */
export type MaintenanceType = 'MONTHLY' | 'ONE_TIME' | 'NONE';

export const MAINTENANCE_CHOICES: { value: MaintenanceType; label: string; hint: string }[] = [
  { value: 'MONTHLY', label: 'Every month', hint: 'Billed with rent, every month' },
  { value: 'ONE_TIME', label: 'Once at move-in', hint: 'A single joining charge' },
  { value: 'NONE', label: 'Not charged', hint: 'No maintenance at all' },
];

export interface InviteDefaultsForm {
  /** Fill a new tenant's rent from the room they are given. */
  useRoomRent: boolean;
  /** Rupees. What it means depends on `maintenanceType`. 0 means none. */
  maintenanceAmount: number;
  maintenanceType: MaintenanceType;
  /** Months. 0 means the hostel has not set one. */
  agreementMonths: number;
  /** Hours an invite link stays valid. */
  inviteExpiryHours: number;
}

export const DEFAULT_INVITE_EXPIRY_HOURS = 48;

function count(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/**
 * An amount with no type stored is monthly — the backend column's own default,
 * and what every tenancy created before the type was selectable actually got.
 * An amount of zero is NONE whatever the stored type says, so a cleared charge
 * cannot leave a type behind that still describes one.
 */
export function normaliseMaintenanceType(type: unknown, amount: number): MaintenanceType {
  if (amount <= 0) return 'NONE';
  const value = String(type ?? '').toUpperCase();
  return value === 'ONE_TIME' ? 'ONE_TIME' : 'MONTHLY';
}

export function toInviteDefaultsForm(policy: any): InviteDefaultsForm {
  const invite = policy?.billing?.invite_defaults ?? {};
  return {
    // Absent means on: the backend's own default, and the behaviour an owner
    // who has never opened this screen already has.
    useRoomRent: invite.auto_fill_room_rent !== false,
    maintenanceAmount: count(policy?.billing?.maintenance?.amount),
    maintenanceType: normaliseMaintenanceType(policy?.billing?.maintenance?.type, count(policy?.billing?.maintenance?.amount)),
    agreementMonths: count(invite.agreement_duration_months),
    inviteExpiryHours: count(policy?.tenant_rules?.invite_expiry_hours, DEFAULT_INVITE_EXPIRY_HOURS)
      || DEFAULT_INVITE_EXPIRY_HOURS,
  };
}

/**
 * Written whole, per section, for the reason the late-fee shape is:
 * `maintenance` carries a `type` alongside its amount, and writing the amount
 * alone would leave a stale type describing a charge that no longer matches.
 */
export function buildInviteDefaultsPatch(values: InviteDefaultsForm) {
  return {
    billing: {
      invite_defaults: {
        auto_fill_room_rent: values.useRoomRent,
        agreement_duration_months: values.agreementMonths,
      },
      maintenance: {
        type: normaliseMaintenanceType(values.maintenanceType, values.maintenanceAmount),
        amount: values.maintenanceAmount,
      },
    },
    tenant_rules: {
      invite_expiry_hours: values.inviteExpiryHours,
    },
  };
}

/** "2 days" reads better than "48 hours" for every value an owner picks. */
export function describeInviteExpiry(hours: number): string {
  const h = count(hours, DEFAULT_INVITE_EXPIRY_HOURS);
  if (h <= 0) return 'Never expires';
  if (h % 24 === 0) {
    const days = h / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/**
 * What a new tenant in a given room would be charged, before the owner edits
 * anything. The point of the screen is that this line is already right.
 */
export function previewMonthlyCharge(values: InviteDefaultsForm, roomRent: number | null | undefined): string {
  const rent = count(roomRent);
  const type = normaliseMaintenanceType(values.maintenanceType, values.maintenanceAmount);
  const maintenance = values.maintenanceAmount.toLocaleString('en-IN');

  if (!values.useRoomRent || rent <= 0) {
    if (type === 'NONE') return 'Rent typed per tenant';
    return type === 'ONE_TIME'
      ? `Rent typed per tenant, plus ₹${maintenance} once at move-in`
      : `Rent typed per tenant, plus ₹${maintenance} maintenance a month`;
  }

  if (type === 'NONE') return `₹${rent.toLocaleString('en-IN')} a month`;

  // A one-time charge must never be added into a monthly total: that is the
  // exact confusion having two types is meant to remove.
  if (type === 'ONE_TIME') {
    return `₹${rent.toLocaleString('en-IN')} a month, plus ₹${maintenance} once at move-in`;
  }

  const total = rent + values.maintenanceAmount;
  return `₹${rent.toLocaleString('en-IN')} + ₹${maintenance} maintenance = ₹${total.toLocaleString('en-IN')} a month`;
}
