/**
 * What an invite form should already say before the owner types anything.
 *
 * ## Why this exists
 *
 * Two problems met here.
 *
 * `EMPTY_INVITE_WIZARD_DATA` shipped **hardcoded** values — `monthlyRent:
 * '8000'`, `deposit: '16000'`, `agreementMonths: '11'`, `billing: 'Monthly'`.
 * Those were somebody's test numbers, and every owner in the country started
 * every invite by *correcting* them. In admission season that is thirty
 * corrections, and a number an owner failed to correct is a wrong rent on a
 * real tenancy.
 *
 * Meanwhile `billing.invite_defaults.auto_fill_room_rent` was stored,
 * defaulted and normalised on the backend — and **read by nothing**. The
 * setting existed, the owner could toggle it, and it changed no behaviour
 * anywhere. This module is what makes it true.
 *
 * ## The rules
 *
 * A blank field beats a wrong one. Where the hostel has not said what its
 * rent is, this returns an empty string rather than inventing a figure: an
 * owner who sees a blank types their number, while an owner who sees ₹8,000
 * may not notice it is not theirs.
 *
 * Deposit follows the hostel's own deposit policy, including the
 * months-of-rent mode, so "two months' rent" stays two months' rent when the
 * rent changes rather than freezing into a stale figure.
 */

export interface InviteDefaultsPolicy {
  billing?: {
    rent_cycle?: string | null;
    maintenance?: { type?: string | null; amount?: number | null } | null;
    deposit?: {
      enabled?: boolean | null;
      default_amount?: number | null;
      calculation_mode?: string | null;
      deposit_months?: number | null;
    } | null;
    invite_defaults?: {
      auto_fill_room_rent?: boolean | null;
      agreement_duration_months?: number | null;
    } | null;
  } | null;
}

export interface InviteDefaultsRoom {
  /** The room's own rent, when a room has already been chosen. */
  baseRent?: number | null;
}

export interface InviteDefaults {
  monthlyRent: string;
  deposit: string;
  maintenance: string;
  /** MONTHLY | ONE_TIME | NONE, from the hostel's own maintenance policy. */
  maintenanceType: string;
  agreementMonths: string;
  billing: string;
}

/** Money is shown as plain digits in these fields — no separators, no decimals. */
function money(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Math.round(n));
}

/**
 * `rent_cycle` is stored as an upper-case token; the invite form's select
 * holds human labels. Anything unrecognised falls back to Monthly, which is
 * what all but a handful of tenancies use.
 */
export function billingLabelFor(rentCycle: string | null | undefined): string {
  switch (String(rentCycle ?? '').toUpperCase()) {
    case 'QUARTERLY':
      return 'Quarterly';
    case 'HALF_YEARLY':
      return 'Half-yearly';
    case 'ACADEMIC_YEARLY':
      return 'Academic year';
    default:
      return 'Monthly';
  }
}

/**
 * The deposit this hostel would ask of a tenant paying `rent`.
 *
 * Returns '' when deposits are switched off, or when the hostel charges a
 * multiple of rent and no rent is known yet — a deposit derived from a rent
 * the owner has not entered would be a number pulled from nowhere.
 */
export function depositFor(policy: InviteDefaultsPolicy, rent: string): string {
  const deposit = policy?.billing?.deposit;
  if (!deposit || deposit.enabled === false) return '';

  if (String(deposit.calculation_mode ?? '').toUpperCase() === 'MONTHS_OF_RENT') {
    const months = Number(deposit.deposit_months);
    const rentValue = Number(rent);
    if (!Number.isFinite(months) || months <= 0) return '';
    if (!Number.isFinite(rentValue) || rentValue <= 0) return '';
    return money(months * rentValue);
  }

  return money(deposit.default_amount);
}

export function inviteDefaults(
  policy: InviteDefaultsPolicy | null | undefined,
  room?: InviteDefaultsRoom | null,
): InviteDefaults {
  const p = policy ?? {};
  const invite = p.billing?.invite_defaults ?? {};

  // Only fills from the room when the hostel asked for it. That switch had no
  // effect on anything before this module.
  const autoFill = invite.auto_fill_room_rent !== false;
  const monthlyRent = autoFill ? money(room?.baseRent) : '';

  const months = Number(invite.agreement_duration_months);

  return {
    monthlyRent,
    deposit: depositFor(p, monthlyRent),
    maintenance: money(p.billing?.maintenance?.amount),
    // A stored amount with no type is monthly — the backend column's default.
    // Zero is NONE whatever was stored, so a cleared charge leaves no type
    // behind describing one.
    maintenanceType:
      money(p.billing?.maintenance?.amount) === ''
        ? 'NONE'
        : String(p.billing?.maintenance?.type ?? '').toUpperCase() === 'ONE_TIME'
          ? 'ONE_TIME'
          : 'MONTHLY',
    agreementMonths: Number.isFinite(months) && months > 0 ? String(Math.round(months)) : '',
    billing: billingLabelFor(p.billing?.rent_cycle),
  };
}

/**
 * Fill the blanks, never overwrite.
 *
 * Applied when a room is chosen, which can happen after the owner has already
 * typed a rent for this particular tenant — an agreed figure that differs
 * from the room's list price is common, and silently replacing it with the
 * default would be the same bug the hardcoded ₹8,000 caused, just later in
 * the flow. Only fields the owner has left empty are touched.
 */
export function applyInviteDefaults<T extends Partial<InviteDefaults>>(
  current: T,
  defaults: InviteDefaults,
): Partial<InviteDefaults> {
  const patch: Partial<InviteDefaults> = {};
  (Object.keys(defaults) as (keyof InviteDefaults)[]).forEach((key) => {
    const existing = String(current?.[key] ?? '').trim();
    const suggested = defaults[key];
    if (!existing && suggested) patch[key] = suggested;
  });
  return patch;
}
