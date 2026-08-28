/**
 * Every decision the owner move-out sheet makes, as pure functions.
 *
 * The sheet itself is a renderer over this file. That split is the repo's
 * testing contract (`apps/frontend` runs node-environment vitest over
 * `src/**\/*.test.ts` and never renders a component), but it earns its keep
 * here for a second reason: the things most worth getting right in this flow
 * are judgements about money — which lane an exit belongs in, what a button
 * is about to do to ₹25,000 — and those are exactly what a component test
 * would struggle to pin down.
 *
 * Background on why the flow was reshaped: ADR-122.
 */

export const MOVE_OUT_STATUS_ORDER = [
  'REQUESTED',
  'SETTLEMENT_PENDING',
  'SETTLEMENT_APPROVED',
  'PHYSICALLY_VACATED',
  'SETTLEMENT_PENDING_PAYMENT',
  'COMPLETED',
] as const;

export type SettlementDirection = 'OWNER_OWES_TENANT' | 'TENANT_OWES_OWNER' | 'SETTLED';
export type DuesDisposition = 'RECOVERABLE' | 'WAIVE';

export interface SettlementPreview {
  net_settlement_amount: number;
  settlement_direction: SettlementDirection;
  total_dues: number;
  total_deductions: number;
  security_deposit_amount: number;
  advance_balance: number;
}

export interface MoveOutRequestLike {
  id: string;
  tenant_id: string;
  status: string;
}

/** Legacy spellings still readable in the database — mirrors the backend's `move-out-status.ts`. */
const LEGACY_ALIASES: Record<string, string> = {
  APPROVED: 'SETTLEMENT_APPROVED',
  VACATED: 'PHYSICALLY_VACATED',
};

export function canonicalStatus(status: unknown): string {
  const value = String(status ?? '').toUpperCase();
  return LEGACY_ALIASES[value] ?? value;
}

export const TERMINAL_STATUSES = ['COMPLETED', 'REJECTED'];

export function isTerminal(status: unknown): boolean {
  return TERMINAL_STATUSES.includes(canonicalStatus(status));
}

/**
 * Find the move-out request this sheet should be driving.
 *
 * The old sheet did `requests.find(r => r.tenant_id === tenantId)` against a
 * `created_at desc` page — no status filter — which produced two real
 * failures. A tenant re-admitted after a previous stay matched their old
 * COMPLETED request, so the sheet showed "Move-out completed" forever with no
 * way to start a new one. And the list is one page of 50 per hostel, so past
 * 50 requests an in-flight one could fall off the end and the sheet would
 * offer "Initiate Move Out" to someone who already had one open.
 *
 * An *active* request always wins over a terminal one, whatever the order the
 * list arrived in. The most recent terminal request is returned separately so
 * a completed exit can still show its receipt without being mistaken for
 * something the owner still has to act on.
 */
export function resolveActiveRequest<T extends MoveOutRequestLike>(
  requests: T[] | undefined | null,
  tenantId: string,
): { active: T | null; lastCompleted: T | null } {
  const mine = (requests ?? []).filter((r) => String(r.tenant_id) === tenantId);
  return {
    active: mine.find((r) => !isTerminal(r.status)) ?? null,
    lastCompleted: mine.find((r) => canonicalStatus(r.status) === 'COMPLETED') ?? null,
  };
}

export type ExitLane = 'FAST' | 'FULL';

export interface LaneDecision {
  lane: ExitLane;
  /** Why the full flow is required — shown to the owner, so it must read as a reason, not a flag name. */
  blockers: string[];
  /** True when money has to change hands before this exit can close. */
  moneyMoves: boolean;
}

/**
 * Which lane this exit belongs in.
 *
 * The fast lane is not "the easy case" — it is the case where there is
 * nothing left to *decide*. An owner recording that a tenant finished their
 * course and went home is doing bookkeeping; making them walk an inspection
 * form, a settlement approval and a vacate form to say so is ceremony priced
 * for a dispute and charged to everybody.
 *
 * Note what does NOT force the full lane: a deposit to refund, or dues to
 * collect. Money moving is normal at move-out, and the fast screen can take a
 * payment mode inline. What forces the full lane is a *disagreement* (an open
 * dispute) or a *judgement* (damages to assess) — things that need the owner
 * to look at the room and put numbers on it.
 */
export function decideLane(input: {
  preview: SettlementPreview | null;
  hasOpenDispute: boolean;
  suspectsDamage?: boolean;
}): LaneDecision {
  const blockers: string[] = [];

  if (input.hasOpenDispute) {
    blockers.push('There is an open dispute on this move-out. Settle that first.');
  }
  if (input.suspectsDamage) {
    blockers.push('You chose to record room damage or cleaning charges.');
  }
  if (!input.preview) {
    blockers.push("The final settlement could not be calculated, so it can't be confirmed in one step.");
  }
  if (input.preview && Number(input.preview.total_deductions) > 0) {
    blockers.push('Deductions have already been recorded against this exit.');
  }

  const net = Number(input.preview?.net_settlement_amount ?? 0);

  return {
    lane: blockers.length > 0 ? 'FULL' : 'FAST',
    blockers,
    moneyMoves: Math.abs(net) > 0.01,
  };
}

export interface SettlementSummary {
  /** What the money is doing, in the owner's words. */
  headline: string;
  /** Always positive — the direction is carried by `headline`/`direction`. */
  amount: number;
  direction: SettlementDirection;
  /** True when the owner has to hand money over rather than receive it. */
  ownerPays: boolean;
}

/**
 * The settlement, said out loud.
 *
 * The bug this replaces: the completion button read "Confirm Refund &
 * Complete" regardless of direction, so an owner closing an exit where the
 * tenant owed ₹25,000 was told they were issuing a refund. Direction is now
 * derived once, here, and every label downstream reads from it.
 */
export function summariseSettlement(preview: SettlementPreview | null): SettlementSummary {
  const net = Number(preview?.net_settlement_amount ?? 0);
  const direction: SettlementDirection = preview?.settlement_direction ?? 'SETTLED';
  const amount = Math.abs(net);

  if (direction === 'OWNER_OWES_TENANT' && amount > 0.01) {
    return { headline: 'You refund the tenant', amount, direction, ownerPays: true };
  }
  if (direction === 'TENANT_OWES_OWNER' && amount > 0.01) {
    return { headline: 'The tenant still owes you', amount, direction, ownerPays: false };
  }
  return { headline: 'Nothing owed either way', amount: 0, direction: 'SETTLED', ownerPays: false };
}

/**
 * The label on the button that ends the tenancy.
 *
 * It states the amount and the direction, because this is the last moment
 * before the money is settled and — when the owner has chosen to write dues
 * off — the only place that choice is visible as a number.
 */
export function completionLabel(
  summary: SettlementSummary,
  duesDisposition: DuesDisposition,
  outstandingDues: number,
): string {
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  if (duesDisposition === 'WAIVE' && outstandingDues > 0.01) {
    return `Write off ${rupees(outstandingDues)} & close`;
  }
  if (summary.ownerPays) return `Refund ${rupees(summary.amount)} & close`;
  if (summary.direction === 'TENANT_OWES_OWNER') return `Close & keep ${rupees(summary.amount)} on their account`;
  return 'Complete move-out';
}

/**
 * What this action is about to do, in sentences the owner can check.
 *
 * Trust in an irreversible money action comes from being told the
 * consequences before the tap, not from a success toast after it. Each line
 * corresponds to something the backend actually does in
 * `moveOutService.vacate`/`confirmPaymentAndComplete` — if a line here has no
 * counterpart there, it is a lie, so keep them in step.
 */
export function buildConsequences(input: {
  tenantName: string;
  roomNo?: string | null;
  summary: SettlementSummary;
  outstandingDues: number;
  duesDisposition: DuesDisposition;
  exitDateLabel: string;
  exitIsFuture: boolean;
}): string[] {
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const lines: string[] = [];

  lines.push(
    input.exitIsFuture
      ? `${input.tenantName} stays active until ${input.exitDateLabel}, then becomes a former tenant automatically.`
      : `${input.tenantName} becomes a former tenant, dated ${input.exitDateLabel}.`,
  );

  lines.push(
    input.exitIsFuture
      ? `Bed ${input.roomNo ? `in room ${input.roomNo} ` : ''}frees up on ${input.exitDateLabel} and can be re-let from then.`
      : `Bed ${input.roomNo ? `in room ${input.roomNo} ` : ''}frees up immediately and can be re-let.`,
  );

  if (input.summary.ownerPays) {
    lines.push(`You pay ${rupees(input.summary.amount)} back to them, recorded against this exit.`);
  } else if (input.summary.direction === 'TENANT_OWES_OWNER') {
    lines.push(`${rupees(input.summary.amount)} is settled from their deposit and advance.`);
  }

  if (input.outstandingDues > 0.01) {
    lines.push(
      input.duesDisposition === 'WAIVE'
        ? `${rupees(input.outstandingDues)} of unpaid rent is written off. This cannot be undone.`
        : `${rupees(input.outstandingDues)} of unpaid rent stays on their account — you can still collect it. No late fees or reminders will be added after today.`,
    );
  }

  lines.push('They keep read-only access to their settlement, and lose the tenant dashboard.');
  lines.push('No new rent will be generated for them.');

  return lines;
}

/**
 * How far along a staged exit is — for the progress line in the full lane.
 *
 * The old sheet showed one form at a time with no indication of how many
 * remained, so every step looked like it might be the last one, and none of
 * them was.
 */
export function exitProgress(status: unknown): { step: number; total: number; label: string } {
  const canonical = canonicalStatus(status);
  const labels: Record<string, string> = {
    REQUESTED: 'Check the room',
    SETTLEMENT_PENDING: 'Confirm the money',
    SETTLEMENT_APPROVED: 'Release the bed',
    PHYSICALLY_VACATED: 'Settle up',
    SETTLEMENT_PENDING_PAYMENT: 'Settle up',
    COMPLETED: 'Done',
  };
  const index = MOVE_OUT_STATUS_ORDER.indexOf(canonical as (typeof MOVE_OUT_STATUS_ORDER)[number]);
  // PHYSICALLY_VACATED and SETTLEMENT_PENDING_PAYMENT are the same step to an
  // owner — one is just the variant where the money is still outstanding.
  const step = index < 0 ? 1 : Math.min(index + 1, 4);
  return { step, total: 4, label: labels[canonical] ?? 'Move out' };
}
