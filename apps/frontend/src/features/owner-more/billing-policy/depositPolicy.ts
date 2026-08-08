/**
 * Security deposit: the two ways it can be calculated, and what each one means
 * in rupees before the owner saves.
 *
 * **Why a preview.** The stored policy is a mode plus a number; the amount a
 * tenant actually pays is only computed later, per room, inside
 * `hostel-billing-preferences-service.resolveTenantInviteDefaults`. An owner
 * setting "2 months" has no way to know that means ₹16,000 for an ₹8,000 room
 * until an invite is already going out. These helpers state the outcome up
 * front, in the same arithmetic the backend will do.
 *
 * **The rule being mirrored** (resolveTenantInviteDefaults):
 *
 *     rent = auto_fill_room_rent ? room.base_rent : 0
 *     FLAT            -> security_deposit (a fixed amount)
 *     MONTHS_OF_RENT  -> deposit_months * rent
 *
 * That `auto_fill_room_rent` term is why `MONTHS_OF_RENT` can silently resolve
 * to ₹0 — a trap this module surfaces rather than hides.
 *
 * Pure — no React, no network — so every number the owner is shown is testable.
 */

import { formatINR } from './billingPolicy';

export type DepositMode = 'FLAT' | 'MONTHS_OF_RENT';

/** What the hostel's rooms actually charge, as far as a preview needs to know. */
export interface RentSpread {
  count: number;
  min: number;
  max: number;
  /** Every room charges the same rent, so one exact figure can be shown. */
  uniform: boolean;
}

export function summarizeRents(rents: number[]): RentSpread {
  const valid = rents.filter((r) => Number.isFinite(r) && r > 0);
  if (valid.length === 0) return { count: 0, min: 0, max: 0, uniform: false };
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return { count: valid.length, min, max, uniform: min === max };
}

export interface DepositPreviewInput {
  enabled: boolean;
  mode: DepositMode;
  /** Rupees, used only in FLAT mode. */
  flatAmount: number;
  /** Months, used only in MONTHS_OF_RENT mode. */
  months: number;
  /** Base rents of the hostel's rooms, in rupees. */
  rents: number[];
  /** `billing.invite_defaults.auto_fill_room_rent` — see the module note. */
  autoFillRoomRent: boolean;
}

export interface DepositPreview {
  /** The amount, as large type. */
  headline: string;
  /** How that amount was arrived at. */
  detail: string;
  /** Present only when the current settings will not do what they appear to. */
  warning?: string;
}

const MONTHS = (n: number) => `${n} month${n === 1 ? '' : 's'}`;

export function depositPreview(input: DepositPreviewInput): DepositPreview {
  const { enabled, mode, flatAmount, months, rents, autoFillRoomRent } = input;

  if (!enabled) {
    return {
      headline: 'No deposit',
      detail: 'Tenants move in without paying a deposit.',
    };
  }

  if (mode === 'FLAT') {
    if (flatAmount <= 0) {
      return {
        headline: 'No deposit',
        detail: 'Every tenant pays the same fixed amount, whatever their rent.',
        warning: 'The amount is ₹0, so nothing will be collected at move-in.',
      };
    }
    return {
      headline: `${formatINR(flatAmount)} at move-in`,
      detail: 'Every tenant pays this same amount, whatever their room rent is.',
    };
  }

  // MONTHS_OF_RENT — the backend multiplies by the room's rent at invite time.
  const spread = summarizeRents(rents);

  // Checked before the rent spread: with auto-fill off the multiplication uses
  // rent = 0, so the amount would be ₹0 no matter what the rooms charge.
  if (!autoFillRoomRent) {
    return {
      headline: 'No deposit',
      detail: `${MONTHS(months)} of rent, but room rent is not filled in automatically on invites.`,
      warning:
        'Because rent is not auto-filled, months-of-rent works out to ₹0. Either switch to a fixed amount, or turn on auto-fill of room rent.',
    };
  }

  if (spread.count === 0) {
    return {
      headline: `${MONTHS(months)} of rent`,
      detail: 'Add rooms with rents to see what this works out to.',
    };
  }

  if (spread.uniform) {
    return {
      headline: formatINR(months * spread.min),
      detail: `${MONTHS(months)} × ${formatINR(spread.min)} rent = ${formatINR(months * spread.min)}`,
    };
  }

  return {
    headline: `${formatINR(months * spread.min)} – ${formatINR(months * spread.max)}`,
    detail: `${MONTHS(months)} × each room's rent, which ranges ${formatINR(spread.min)}–${formatINR(
      spread.max,
    )} across ${spread.count} rooms.`,
  };
}

/** One-line description of the stored policy, for the Finance row. */
export function describeDeposit(input: {
  enabled: boolean;
  mode: DepositMode;
  flatAmount: number;
  months: number;
  refundable: boolean;
}): string {
  const { enabled, mode, flatAmount, months, refundable } = input;
  if (!enabled) return 'Not required';
  const tail = refundable ? 'Refundable at move-out' : 'Non-refundable';
  const amount = mode === 'MONTHS_OF_RENT' ? `${MONTHS(months)} of rent` : formatINR(flatAmount);
  return `${amount} · ${tail}`;
}
