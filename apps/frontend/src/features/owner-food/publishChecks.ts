import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { cellAt, DAY_ORDER, isFilled, SLOT_ORDER, type WeekGrid } from './weekGrid';

export interface PublishCheck {
  id: 'complete' | 'variety' | 'runs' | 'votes';
  status: 'PASS' | 'WARN';
  label: string;
}

export interface PublishCheckInput {
  grid: WeekGrid;
  votesConsidered: boolean;
  /**
   * Vote *rows*, not students — one tenant may hold several rows per meal
   * type, so this is deliberately not called a voter count.
   */
  voteCount: number;
}

/**
 * Was this schedule actually built from a voting period?
 *
 * "A voting period exists for this month" is a different question, and
 * answering it here claimed votes were used for a week assembled from none
 * (carry-forward while voting was still open). `generated_from_voting_period_id`
 * is the field the generator writes when it really did rank by votes.
 */
export function hasVotesApplied(
  schedule: { generated_from_voting_period_id?: string | null } | null | undefined,
): boolean {
  return Boolean(schedule?.generated_from_voting_period_id);
}

const TOTAL_CELLS = DAY_ORDER.length * SLOT_ORDER.length;
/** Above this share of the week, one item is no longer variety — it's a default. */
const DOMINANCE_LIMIT = 3;

/**
 * The pre-flight readout shown above Publish.
 *
 * Every line is arithmetic over the week already in hand — no new endpoint, no
 * model. Deliberately returns only PASS or WARN: **checks inform, they never
 * block.** A publish button that a check can disable is a product arguing with
 * its owner, and the owner is the one who knows whether Dosa every day is fine.
 *
 * This exists because a menu of Dosa x7, Sambar Rice x7 and empty snacks was
 * published to real tenants with nothing anywhere pointing it out.
 */
export function buildPublishChecks({ grid, votesConsidered, voteCount }: PublishCheckInput): PublishCheck[] {
  const filledCells = DAY_ORDER.flatMap((day) => SLOT_ORDER.map((slot) => cellAt(grid, day, slot))).filter(isFilled);
  const filled = filledCells.length;

  const emptySlots = SLOT_ORDER.filter(
    (slot) => DAY_ORDER.every((day) => !isFilled(cellAt(grid, day, slot))),
  );

  const complete: PublishCheck =
    filled === TOTAL_CELLS
      ? { id: 'complete', status: 'PASS', label: `All ${TOTAL_CELLS} meals filled` }
      : {
          id: 'complete',
          status: 'WARN',
          label: emptySlots.length
            ? `${filled} of ${TOTAL_CELLS} meals filled — ${emptySlots.map((s) => MEAL_CATEGORY_META[s].label.toLowerCase()).join(' and ')} empty all week`
            : `${filled} of ${TOTAL_CELLS} meals filled`,
        };

  // Every meal type that is dominated, not just the worst one. The menu that
  // motivated this check was Dosa x7 breakfast AND Sambar Rice x7 lunch —
  // reporting only the worst silently endorsed the other. Above the limit
  // (>3 of 7) at most one item per meal type can qualify, so this is one line
  // per meal type at most.
  const dominant: { slot: MealSlotKey; name: string; count: number }[] = [];
  for (const slot of SLOT_ORDER) {
    const counts = new Map<string, number>();
    for (const day of DAY_ORDER) {
      const cell = cellAt(grid, day, slot);
      if (isFilled(cell)) counts.set(cell!.item_name, (counts.get(cell!.item_name) ?? 0) + 1);
    }
    let worst: { slot: MealSlotKey; name: string; count: number } | null = null;
    for (const [name, count] of counts) {
      if (!worst || count > worst.count) worst = { slot, name, count };
    }
    if (worst && worst.count > DOMINANCE_LIMIT) dominant.push(worst);
  }

  const variety: PublishCheck =
    dominant.length > 0
      ? {
          id: 'variety',
          status: 'WARN',
          label: dominant
            .map((d) => `${MEAL_CATEGORY_META[d.slot].label} is ${d.name} ${d.count} of ${DAY_ORDER.length} days`)
            .join(' · '),
        }
      : { id: 'variety', status: 'PASS', label: 'Good variety across the week' };

  // Wraps Sunday->Monday: one row per (day, meal) means the week repeats all
  // month, so Sunday's dinner really is followed by Monday's, four times over.
  let hasRun = false;
  for (const slot of SLOT_ORDER) {
    for (let i = 0; i < DAY_ORDER.length; i++) {
      const prev = cellAt(grid, DAY_ORDER[i], slot);
      const curr = cellAt(grid, DAY_ORDER[(i + 1) % DAY_ORDER.length], slot);
      if (isFilled(prev) && isFilled(curr) && prev!.item_name === curr!.item_name) hasRun = true;
    }
  }

  const runs: PublishCheck = hasRun
    ? { id: 'runs', status: 'WARN', label: 'Some meals repeat on back-to-back days' }
    : { id: 'runs', status: 'PASS', label: 'Nothing repeats two days running' };

  const votes: PublishCheck =
    votesConsidered && voteCount > 0
      ? { id: 'votes', status: 'PASS', label: `${voteCount} student ${voteCount === 1 ? 'vote' : 'votes'} used` }
      : { id: 'votes', status: 'WARN', label: 'Built without student votes' };

  return [complete, variety, runs, votes];
}
