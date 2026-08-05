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
  voterCount: number;
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
export function buildPublishChecks({ grid, votesConsidered, voterCount }: PublishCheckInput): PublishCheck[] {
  // Count against cells actually present in the grid, not every one of the 28
  // day/slot combinations: a day/slot with no row at all (never generated)
  // reads the same as complete here, while a row present but named "Not set"
  // is the real gap this check exists to surface.
  const presentUnfilled = grid.filter((c) => !isFilled(c)).length;
  const filled = TOTAL_CELLS - presentUnfilled;

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

  let worst: { slot: MealSlotKey; name: string; count: number } | null = null;
  for (const slot of SLOT_ORDER) {
    const counts = new Map<string, number>();
    for (const day of DAY_ORDER) {
      const cell = cellAt(grid, day, slot);
      if (isFilled(cell)) counts.set(cell!.item_name, (counts.get(cell!.item_name) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
      if (!worst || count > worst.count) worst = { slot, name, count };
    }
  }

  const variety: PublishCheck =
    worst && worst.count > DOMINANCE_LIMIT
      ? {
          id: 'variety',
          status: 'WARN',
          label: `${MEAL_CATEGORY_META[worst.slot].label} is ${worst.name} ${worst.count} of ${DAY_ORDER.length} days`,
        }
      : { id: 'variety', status: 'PASS', label: 'Good variety across the week' };

  let hasRun = false;
  for (const slot of SLOT_ORDER) {
    for (let i = 1; i < DAY_ORDER.length; i++) {
      const prev = cellAt(grid, DAY_ORDER[i - 1], slot);
      const curr = cellAt(grid, DAY_ORDER[i], slot);
      if (isFilled(prev) && isFilled(curr) && prev!.item_name === curr!.item_name) hasRun = true;
    }
  }

  const runs: PublishCheck = hasRun
    ? { id: 'runs', status: 'WARN', label: 'Some meals repeat on back-to-back days' }
    : { id: 'runs', status: 'PASS', label: 'Nothing repeats two days running' };

  const votes: PublishCheck =
    votesConsidered && voterCount > 0
      ? { id: 'votes', status: 'PASS', label: `${voterCount} student ${voterCount === 1 ? 'vote' : 'votes'} used` }
      : { id: 'votes', status: 'WARN', label: 'Built without student votes' };

  return [complete, variety, runs, votes];
}
