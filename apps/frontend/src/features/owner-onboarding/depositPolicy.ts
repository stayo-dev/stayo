/**
 * How an owner expresses their security deposit.
 *
 * The step used to be a single rupee field pre-filled with 10000, which cannot
 * say "two months' rent" — the common norm — and forces an amount on owners
 * who take no deposit at all. It now asks whether there is a deposit, and only
 * then how it is expressed.
 *
 * The backend stores one number (`hostels.deposit`), so the months form is
 * resolved against the monthly rent here. Pure, so the arithmetic and the
 * validation are testable without a DOM.
 */

export type DepositMode = 'MONTHS' | 'FLAT';

export type DepositState = {
  takesDeposit: boolean;
  mode: DepositMode;
  /** Months of rent, as typed. String so a half-typed value is representable. */
  months: string;
  /** Flat rupee amount, as typed. */
  flatAmount: string;
};

export const INITIAL_DEPOSIT: DepositState = {
  takesDeposit: true,
  mode: 'MONTHS',
  months: '2',
  flatAmount: '',
};

/** Deposits beyond this are almost certainly a typo, not a policy. */
const MAX_MONTHS = 12;

/**
 * The single rupee figure to store.
 *
 * Returns 0 when no deposit is taken — an explicit "we take nothing", not a
 * missing value.
 */
export function resolveDepositAmount(state: DepositState, monthlyRent: string | number): number {
  if (!state.takesDeposit) return 0;

  if (state.mode === 'FLAT') {
    const flat = Number(String(state.flatAmount ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(flat) && flat > 0 ? Math.round(flat) : 0;
  }

  const months = Number(String(state.months ?? '').replace(/[^\d.]/g, ''));
  const rent = Number(String(monthlyRent ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(months) || !Number.isFinite(rent) || months <= 0 || rent <= 0) return 0;

  return Math.round(months * rent);
}

/** Validation error for the current answer, or null if it may proceed. */
export function validateDeposit(state: DepositState, monthlyRent: string | number): string | null {
  if (!state.takesDeposit) return null;

  if (state.mode === 'MONTHS') {
    const raw = String(state.months ?? '').trim();
    if (!raw) return 'How many months of rent?';
    const months = Number(raw);
    if (!Number.isFinite(months) || months <= 0) return 'Enter a number of months.';
    if (months > MAX_MONTHS) return `That's more than ${MAX_MONTHS} months — please check.`;

    const rent = Number(String(monthlyRent ?? '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(rent) || rent <= 0) return 'Set a monthly rent first, so we can work this out.';
    return null;
  }

  const raw = String(state.flatAmount ?? '').trim();
  if (!raw) return 'How much is the deposit?';
  const flat = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(flat) || flat <= 0) return 'Enter a deposit amount.';
  return null;
}

/** Plain-language echo of what will be stored, shown under the inputs. */
export function describeDeposit(state: DepositState, monthlyRent: string | number): string {
  if (!state.takesDeposit) return 'No security deposit — tenants pay rent only.';

  const amount = resolveDepositAmount(state, monthlyRent);
  if (amount <= 0) return '';

  const formatted = `₹${amount.toLocaleString('en-IN')}`;
  if (state.mode === 'MONTHS') {
    const months = Number(String(state.months).replace(/[^\d.]/g, ''));
    return `${months} month${months === 1 ? '' : 's'} of rent — ${formatted} today.`;
  }
  return `A flat ${formatted}, whatever the rent.`;
}
