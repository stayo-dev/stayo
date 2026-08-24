import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { cellAt, DAY_ORDER, formatCellItems, isFilled, itemSetKey, sameItemSet, SLOT_ORDER, type WeekGrid, type WeekGridCell } from './weekGrid';

export interface PublishCheck {
  id: 'complete' | 'variety' | 'runs';
  status: 'PASS' | 'WARN';
  label: string;
}

export interface IncompleteCell {
  day: (typeof DAY_ORDER)[number];
  slot: MealSlotKey;
  label: string;
}

export interface PublishCheckResult {
  checks: PublishCheck[];
  /** Every individual day+meal cell with no dish in it — the completeness gate reads this to disable Publish (ADR-114). Empty when the week is fully filled. */
  incompleteCells: IncompleteCell[];
}

export interface PublishCheckInput {
  grid: WeekGrid;
}

const TOTAL_CELLS = DAY_ORDER.length * SLOT_ORDER.length;
/** Above this share of the week, one item is no longer variety — it's a default. */
const DOMINANCE_LIMIT = 3;

const DAY_LABEL: Record<(typeof DAY_ORDER)[number], string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday',
  FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};

/** Whether the week has no incomplete cells — the one thing that gates the Publish button. Variety/runs never do (see below). */
export function canPublish(result: PublishCheckResult): boolean {
  return result.incompleteCells.length === 0;
}

/**
 * The pre-flight readout shown above Publish, plus the completeness gate.
 *
 * Variety and "runs" are arithmetic over the week already in hand and remain
 * informational only — a publish button that a variety check disables is a
 * product arguing with its owner, and the owner is the one who knows whether
 * Dosa every day is fine. That reasoning does not extend to *emptiness*: an
 * unfilled cell isn't a stylistic choice the owner might have meant, it's the
 * "Not set" placeholder tenants would otherwise see live — so, per ADR-114,
 * completeness is the one check that blocks Publish. `incompleteCells` names
 * every empty day+meal individually (not just meal-types empty all week) so
 * the checklist can say exactly what's missing.
 *
 * This exists because a menu of Dosa x7, Sambar Rice x7 and empty snacks was
 * published to real tenants with nothing anywhere pointing it out.
 */
export function buildPublishChecks({ grid }: PublishCheckInput): PublishCheckResult {
  const incompleteCells: IncompleteCell[] = [];
  for (const day of DAY_ORDER) {
    for (const slot of SLOT_ORDER) {
      if (!isFilled(cellAt(grid, day, slot))) {
        incompleteCells.push({ day, slot, label: `${DAY_LABEL[day]} ${MEAL_CATEGORY_META[slot].label}` });
      }
    }
  }
  const filled = TOTAL_CELLS - incompleteCells.length;

  // A short summary line, not the itemized list — the full per-cell
  // breakdown ("⚠️ Monday Dinner — Not set") is what `incompleteCells` is
  // for, rendered as its own list by `PublishChecklist`. Cramming every
  // missing cell into one comma-joined label reads fine for one or two gaps
  // and badly for a brand-new empty month with 28.
  const complete: PublishCheck =
    incompleteCells.length === 0
      ? { id: 'complete', status: 'PASS', label: `All ${TOTAL_CELLS} meals filled` }
      : { id: 'complete', status: 'WARN', label: `${filled} of ${TOTAL_CELLS} meals filled — fill every meal to publish` };

  // Every meal type that is dominated, not just the worst one. The menu that
  // motivated this check was Dosa x7 breakfast AND Sambar Rice x7 lunch —
  // reporting only the worst silently endorsed the other. Above the limit
  // (>3 of 7) at most one distinct dish-combination per meal type can
  // qualify, so this is one line per meal type at most.
  //
  // Grouped by `itemSetKey` (order-independent) rather than the display
  // string, so the same combination of dishes counts as "the same meal" even
  // if the owner reordered them in the picker on one of the days.
  const dominant: { slot: MealSlotKey; name: string; count: number }[] = [];
  for (const slot of SLOT_ORDER) {
    const groups = new Map<string, { cell: WeekGridCell; count: number }>();
    for (const day of DAY_ORDER) {
      const cell = cellAt(grid, day, slot);
      if (!isFilled(cell)) continue;
      const key = itemSetKey(cell);
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { cell: cell!, count: 1 });
    }
    let worst: { slot: MealSlotKey; name: string; count: number } | null = null;
    for (const { cell, count } of groups.values()) {
      if (!worst || count > worst.count) worst = { slot, name: formatCellItems(cell), count };
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
  // `sameItemSet` (order-independent) so a same-dishes-different-order edit
  // doesn't dodge the warning.
  let hasRun = false;
  for (const slot of SLOT_ORDER) {
    for (let i = 0; i < DAY_ORDER.length; i++) {
      const prev = cellAt(grid, DAY_ORDER[i], slot);
      const curr = cellAt(grid, DAY_ORDER[(i + 1) % DAY_ORDER.length], slot);
      if (sameItemSet(prev, curr)) hasRun = true;
    }
  }

  const runs: PublishCheck = hasRun
    ? { id: 'runs', status: 'WARN', label: 'Some meals repeat on back-to-back days' }
    : { id: 'runs', status: 'PASS', label: 'Nothing repeats two days running' };

  return { checks: [complete, variety, runs], incompleteCells };
}
