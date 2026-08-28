/**
 * How credible a tenant is, as a number an owner can act on.
 *
 * Replaces an algorithm (`tenantAnalyticsService.calculateTenantScore`) that
 * had four problems as a credibility signal:
 *
 *  - **Everyone started at 100.** A tenant who had never paid anything read as
 *    `EXCELLENT` — exactly the person an owner most needs warning about.
 *  - **A three-month window.** Two years of perfect payment looked identical
 *    to three months of it.
 *  - **Late payments were charged twice** — once at −10 for being late and
 *    again at −5 for each reminder, though a reminder is sent *because* the
 *    payment is late. Three reminders on one debt cost 25 of 100.
 *  - **Nothing measured commitment**, so a tenant who walked out of an
 *    eleven-month agreement in month two scored the same as one who saw it
 *    through.
 *
 * Two components now — reliability and commitment — and reminders are not an
 * input at all. They remain useful as an *insight*; they are not a second
 * charge for the same behaviour.
 *
 * Pure: every input is a plain value, so the judgement this makes about a
 * person is testable without a database.
 */

export type TenantGrade = "EXCELLENT" | "GOOD" | "FAIR" | "NEEDS_ATTENTION" | "HIGH_RISK";
export type TenantTrend = "IMPROVING" | "STABLE" | "DECLINING";

export interface PaymentCycle {
  dueDate: string;
  /** When it was fully settled; null while still outstanding. */
  settledAt: string | null;
}

export interface Tenancy {
  startedAt: string;
  /** null while the tenant is still living there. */
  endedAt: string | null;
  /**
   * How long this stay was meant to last — the agreement's duration when one
   * was signed, otherwise the hostel's expected tenure. A hostel with
   * agreements switched off (ADR-059) still has a notion of a normal stay, or
   * leaving early could never be measured there at all.
   */
  expectedMonths: number;
}

export interface ScoreInput {
  cycles: PaymentCycle[];
  tenancies: Tenancy[];
  now: Date;
}

export interface TenantScoreResult {
  status: "SCORED" | "INSUFFICIENT_HISTORY";
  score: number | null;
  grade: TenantGrade | null;
  components: { paymentReliability: number | null; commitment: number | null };
  /** Cycles that were actually due and therefore judged. */
  resolvedCycles: number;
  /** How many more are needed before a score means anything. */
  cyclesNeeded: number;
  /** Early departures still inside the decay window. */
  earlyExits: number;
  trend: TenantTrend;
  insights: string[];
}

/** Below this there is not enough behaviour to distinguish a person from a stranger. */
export const MIN_CYCLES_FOR_SCORE = 3;

const RELIABILITY_WEIGHT = 65;
const COMMITMENT_WEIGHT = 35;

/** Full tenure credit at a year of accumulated stay. */
const TENURE_CREDIT_MONTHS = 12;

/** Worst case for walking out on day one, before decay. */
const MAX_EARLY_EXIT_PENALTY = 25;

/** An early exit stops counting entirely after this long. */
export const EARLY_EXIT_DECAY_MONTHS = 18;

/** Below this, a direction would be noise rather than a trend. */
const MIN_CYCLES_FOR_TREND = 6;

/** Cycles due within this window count double. */
const RECENT_WINDOW_MONTHS = 12;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44;

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function monthsBetween(from: string | Date, to: string | Date): number {
  return (toTime(to) - toTime(from)) / (MS_PER_DAY * DAYS_PER_MONTH);
}

export function scoreToGrade(score: number): TenantGrade {
  if (score >= 90) return "EXCELLENT";
  if (score >= 75) return "GOOD";
  if (score >= 60) return "FAIR";
  if (score >= 40) return "NEEDS_ATTENTION";
  return "HIGH_RISK";
}

/**
 * How much credit one cycle earns, from 1 (on time) down to 0.
 *
 * Banded rather than linear because the bands mean different things to an
 * owner: a couple of days is a slip, a fortnight is a problem, and a month is
 * a different kind of tenant. A linear scale would blur those together.
 */
function cycleCredit(daysLate: number): number {
  if (daysLate <= 0) return 1;
  if (daysLate <= 3) return 0.85;
  if (daysLate <= 10) return 0.6;
  if (daysLate <= 30) return 0.3;
  return 0;
}

interface JudgedCycle {
  credit: number;
  weight: number;
  daysLate: number;
}

function judgeCycles(cycles: PaymentCycle[], now: Date): JudgedCycle[] {
  const judged: JudgedCycle[] = [];

  for (const cycle of cycles) {
    const due = toTime(cycle.dueDate);
    if (Number.isNaN(due) || due > now.getTime()) continue; // not yet due — nothing to judge

    // An unsettled cycle is late by how long it has been outstanding, which
    // keeps getting worse until it is paid. Anything else would let a tenant
    // improve their standing by simply never paying.
    const settled = cycle.settledAt ? toTime(cycle.settledAt) : now.getTime();
    if (Number.isNaN(settled)) continue;

    const daysLate = Math.max(0, Math.ceil((settled - due) / MS_PER_DAY));
    const isRecent = monthsBetween(cycle.dueDate, now) <= RECENT_WINDOW_MONTHS;

    judged.push({ credit: cycleCredit(daysLate), weight: isRecent ? 2 : 1, daysLate });
  }

  return judged;
}

function reliabilityScore(judged: JudgedCycle[]): number {
  const totalWeight = judged.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;
  const earned = judged.reduce((sum, c) => sum + c.credit * c.weight, 0);
  return (earned / totalWeight) * RELIABILITY_WEIGHT;
}

interface CommitmentResult {
  score: number;
  earlyExits: number;
}

function commitmentScore(tenancies: Tenancy[], now: Date): CommitmentResult {
  let totalMonths = 0;
  let penalty = 0;
  let earlyExits = 0;

  for (const tenancy of tenancies) {
    const end = tenancy.endedAt ?? now;
    const stayed = Math.max(0, monthsBetween(tenancy.startedAt, end));
    totalMonths += stayed;

    // A stay still running is not an early exit — being three months into an
    // eleven-month agreement is just being three months in.
    if (!tenancy.endedAt) continue;

    const expected = Math.max(0, tenancy.expectedMonths);
    if (expected <= 0 || stayed >= expected) continue;

    const monthsSince = monthsBetween(tenancy.endedAt, now);
    const decay = Math.max(0, 1 - monthsSince / EARLY_EXIT_DECAY_MONTHS);
    if (decay <= 0) continue; // long enough ago that later behaviour is the story

    const shortfall = (expected - stayed) / expected;
    penalty += MAX_EARLY_EXIT_PENALTY * shortfall * decay;
    earlyExits += 1;
  }

  const tenureCredit = COMMITMENT_WEIGHT * Math.min(1, totalMonths / TENURE_CREDIT_MONTHS);
  return { score: Math.max(0, tenureCredit - penalty), earlyExits };
}

/**
 * Whether they are getting better or worse, from the newer half of their
 * cycles against the older half. Unweighted on purpose — this compares two
 * periods directly, and the recency weighting used for the score would tilt
 * the comparison towards the half it already favours.
 */
function inferTrend(judged: JudgedCycle[]): TenantTrend {
  if (judged.length < MIN_CYCLES_FOR_TREND) return "STABLE";

  const midpoint = Math.floor(judged.length / 2);
  const mean = (slice: JudgedCycle[]) =>
    slice.reduce((sum, c) => sum + c.credit, 0) / (slice.length || 1);

  const delta = mean(judged.slice(midpoint)) - mean(judged.slice(0, midpoint));
  if (delta >= 0.15) return "IMPROVING";
  if (delta <= -0.15) return "DECLINING";
  return "STABLE";
}

function buildInsights(judged: JudgedCycle[], earlyExits: number): string[] {
  const insights: string[] = [];
  const late = judged.filter((c) => c.daysLate > 0);

  if (judged.length === 0) return insights;

  if (late.length === 0) {
    insights.push(`Paid on time every cycle — ${judged.length} in a row.`);
  } else {
    const worst = Math.max(...late.map((c) => c.daysLate));
    insights.push(
      `${late.length} of ${judged.length} payment${judged.length === 1 ? "" : "s"} arrived late.`,
    );
    insights.push(`Longest delay was ${worst} day${worst === 1 ? "" : "s"}.`);
  }

  if (earlyExits > 0) {
    insights.push(
      earlyExits === 1
        ? "Left a previous stay before its expected end."
        : `Left ${earlyExits} previous stays before their expected end.`,
    );
  }

  return insights;
}

export function computeTenantScore(input: ScoreInput): TenantScoreResult {
  const judged = judgeCycles(input.cycles, input.now);
  const commitment = commitmentScore(input.tenancies, input.now);

  if (judged.length < MIN_CYCLES_FOR_SCORE) {
    return {
      status: "INSUFFICIENT_HISTORY",
      score: null,
      grade: null,
      components: { paymentReliability: null, commitment: null },
      resolvedCycles: judged.length,
      cyclesNeeded: MIN_CYCLES_FOR_SCORE - judged.length,
      earlyExits: commitment.earlyExits,
      trend: "STABLE",
      insights: [],
    };
  }

  const reliability = reliabilityScore(judged);
  const total = Math.max(0, Math.min(100, Math.round(reliability + commitment.score)));

  return {
    status: "SCORED",
    score: total,
    grade: scoreToGrade(total),
    components: {
      paymentReliability: Math.round(reliability),
      commitment: Math.round(commitment.score),
    },
    resolvedCycles: judged.length,
    cyclesNeeded: 0,
    earlyExits: commitment.earlyExits,
    trend: inferTrend(judged),
    insights: buildInsights(judged, commitment.earlyExits),
  };
}

export interface EarlyExitProjection {
  /** Null when the tenant has no score yet — nothing to project from. */
  current: number | null;
  projected: number | null;
  /** Points that would be lost. Zero when the stay has run its course. */
  drop: number;
  wouldBeEarly: boolean;
  recoversInMonths: number;
}

/**
 * What leaving today would do to the score.
 *
 * Exists so the tenant can be told before they decide, rather than finding out
 * afterwards. Applies the same model to a copy of the input with the named
 * tenancy closed as of now — so the number quoted to them is produced by the
 * scorer itself and cannot drift from it.
 */
export function projectEarlyExit(
  input: ScoreInput,
  options: { tenancyIndex: number },
): EarlyExitProjection {
  const before = computeTenantScore(input);

  const tenancy = input.tenancies[options.tenancyIndex];
  if (!tenancy) {
    return {
      current: before.score,
      projected: before.score,
      drop: 0,
      wouldBeEarly: false,
      recoversInMonths: EARLY_EXIT_DECAY_MONTHS,
    };
  }

  const tenancies = input.tenancies.map((t, i) =>
    i === options.tenancyIndex ? { ...t, endedAt: input.now.toISOString() } : t,
  );
  const after = computeTenantScore({ ...input, tenancies });

  const stayed = monthsBetween(tenancy.startedAt, input.now);
  const wouldBeEarly = tenancy.expectedMonths > 0 && stayed < tenancy.expectedMonths;

  const drop =
    before.score != null && after.score != null ? Math.max(0, before.score - after.score) : 0;

  return {
    current: before.score,
    projected: after.score,
    drop,
    wouldBeEarly,
    recoversInMonths: EARLY_EXIT_DECAY_MONTHS,
  };
}
