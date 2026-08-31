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

export interface InviteDefaultsForm {
  /** Fill a new tenant's rent from the room they are given. */
  useRoomRent: boolean;
  /** Rupees per month, added to every new tenant. 0 means none. */
  maintenanceAmount: number;
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

export function toInviteDefaultsForm(policy: any): InviteDefaultsForm {
  const invite = policy?.billing?.invite_defaults ?? {};
  return {
    // Absent means on: the backend's own default, and the behaviour an owner
    // who has never opened this screen already has.
    useRoomRent: invite.auto_fill_room_rent !== false,
    maintenanceAmount: count(policy?.billing?.maintenance?.amount),
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
        type: values.maintenanceAmount > 0 ? 'MONTHLY' : 'NONE',
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
  if (!values.useRoomRent || rent <= 0) {
    return values.maintenanceAmount > 0
      ? `Rent typed per tenant, plus ₹${values.maintenanceAmount.toLocaleString('en-IN')} maintenance`
      : 'Rent typed per tenant';
  }
  const total = rent + values.maintenanceAmount;
  return values.maintenanceAmount > 0
    ? `₹${rent.toLocaleString('en-IN')} + ₹${values.maintenanceAmount.toLocaleString('en-IN')} maintenance = ₹${total.toLocaleString('en-IN')} a month`
    : `₹${rent.toLocaleString('en-IN')} a month`;
}
