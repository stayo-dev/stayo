import type { MealSlotKey } from '@shared/mocks/food';
import type { DayKey } from '../../weekGrid';

/**
 * What `MealPlanGrid`/`MealPlanMobile`'s drop-target resolver hands back to
 * the page: which real cell (by id) a drop point landed on, and that cell's
 * current ids — enough for the page to run `addItem`/`setCellItems` itself
 * without the grid/mobile view needing to know what "add" means (ADR-121).
 *
 * `day`/`slot` were added for live drag hover-feedback (highlighting the
 * cell under the pointer, and flagging a meal-type mismatch before drop) —
 * the resolver already computed these internally, this just also returns
 * them rather than only the derived `cellId`.
 */
export interface DropResolution {
  cellId: string;
  currentIds: string[];
  day: DayKey;
  slot: MealSlotKey;
}
