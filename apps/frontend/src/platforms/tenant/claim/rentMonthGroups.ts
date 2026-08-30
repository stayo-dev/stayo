/**
 * Collapsing a claim statement's rent months into something readable.
 *
 * This list is the first thing a tenant ever sees of Stayo, on a screen whose
 * whole job is to make them trust what their owner recorded. A hostel adopting
 * someone six months in produces six identical cards — same rent, same status,
 * same outstanding — and the one line that actually matters ("you owe ₹48,000")
 * is somewhere below the fold. Scrolling past six copies of the same fact is
 * not review; it is what people skip.
 *
 * So consecutive months that say the same thing become one row. A month that
 * differs from its neighbours in any way — a different amount after a rent
 * change, a paid month among unpaid ones, a partial payment — is never folded
 * into a run, because that difference is precisely what a tenant is looking
 * for.
 *
 * Pure, and the grouping rule is the part worth testing: getting it wrong
 * either hides a discrepancy or shows a wall of identical rows. See ADR-151.
 */

export interface ClaimRentMonth {
  obligation_id: string;
  /** ISO date of the month anchor. */
  rent_month: string;
  amount: number;
  status: string;
  outstanding: number;
}

export interface RentMonthGroup {
  /** Every month in this run, oldest first. Length 1 for an ungrouped month. */
  months: ClaimRentMonth[];
  /** True once a run is worth summarising rather than listing. */
  collapsed: boolean;
  amount: number;
  status: string;
  /** Summed across the run. */
  outstanding: number;
}

/** Runs shorter than this read better as themselves than as a summary. */
const MIN_RUN = 3;

function monthIndex(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return null;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

/** Same story: same rent, same state, same amount still owed. */
function sameStory(a: ClaimRentMonth, b: ClaimRentMonth): boolean {
  return a.amount === b.amount && a.status === b.status && a.outstanding === b.outstanding;
}

/** Consecutive calendar months, in order. A gap breaks a run. */
function isNextMonth(previous: ClaimRentMonth, current: ClaimRentMonth): boolean {
  const a = monthIndex(previous.rent_month);
  const b = monthIndex(current.rent_month);
  if (a === null || b === null) return false;
  return b - a === 1;
}

export function groupRentMonths(months: ClaimRentMonth[]): RentMonthGroup[] {
  const rows = months ?? [];
  const groups: RentMonthGroup[] = [];
  let run: ClaimRentMonth[] = [];

  const flush = () => {
    if (run.length === 0) return;
    groups.push({
      months: run,
      collapsed: run.length >= MIN_RUN,
      amount: run[0].amount,
      status: run[0].status,
      outstanding: run.reduce((sum, m) => sum + (Number(m.outstanding) || 0), 0),
    });
    run = [];
  };

  for (const month of rows) {
    if (run.length === 0) {
      run = [month];
      continue;
    }
    const previous = run[run.length - 1];
    if (sameStory(previous, month) && isNextMonth(previous, month)) {
      run.push(month);
      continue;
    }
    flush();
    run = [month];
  }
  flush();

  return groups;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function shortMonth(iso: string, withYear: boolean): string {
  const match = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return iso;
  const name = MONTH_NAMES[Number(match[2]) - 1] ?? '';
  return withYear ? `${name} ${match[1]}` : name;
}

/**
 * "Feb – Jul 2026" for a run inside one year, "Nov 2025 – Feb 2026" across
 * two. The year is stated once where it is unambiguous, because a range that
 * repeats it reads like two separate dates.
 */
export function groupRangeLabel(group: RentMonthGroup): string {
  const first = group.months[0];
  const last = group.months[group.months.length - 1];
  if (!first || !last) return '';
  if (first === last) return shortMonth(first.rent_month, true);

  const sameYear = first.rent_month.slice(0, 4) === last.rent_month.slice(0, 4);
  return `${shortMonth(first.rent_month, !sameYear)} – ${shortMonth(last.rent_month, true)}`;
}
