import type { ReviewQueue } from './reviewQueue';

/**
 * Whether to fix these on screen, or back in the spreadsheet.
 *
 * Both paths exist because neither is right for every import. Three rows with a
 * mistyped phone are quicker to fix here than to find in Excel. Forty rows with
 * a bad room number are the opposite: a web form makes the owner do forty
 * separate interactions with no fill-down, no copy-paste and no sight of the
 * data around them — everything a spreadsheet is good at.
 *
 * So the screen leads with whichever is genuinely less work, and offers the
 * other underneath. Neither is ever hidden.
 */

export type FixStrategy = 'IN_SCREEN' | 'IN_SHEET';

/** Above this many rows needing attention, the spreadsheet wins. */
const TOO_MANY_ROWS = 8;

/** Or when most of the file needs work, however small it is. */
const TOO_LARGE_A_SHARE = 0.4;

export interface FixPlan {
  strategy: FixStrategy;
  /** Rows the owner has to touch. */
  rows: number;
  /** Why this path was chosen, in the owner's terms. */
  reason: string;
  /** The heading above whichever action leads. */
  title: string;
}

export function planFixes(queue: ReviewQueue): FixPlan {
  const rows = queue.needsYou.length;
  const total = rows + queue.ready.length;
  const share = total === 0 ? 0 : rows / total;

  const inSheet = rows > TOO_MANY_ROWS || (rows > 2 && share >= TOO_LARGE_A_SHARE);

  if (!inSheet) {
    return {
      strategy: 'IN_SCREEN',
      rows,
      title: rows === 1 ? 'One row needs a change' : `${rows.toLocaleString('en-IN')} rows need a change`,
      reason: 'Fix them here — it’s quicker than opening the sheet again.',
    };
  }

  return {
    strategy: 'IN_SHEET',
    rows,
    title: `${rows.toLocaleString('en-IN')} rows need a change`,
    reason:
      'That’s a lot to do one at a time. Download your sheet with every problem marked in colour, fix them in the spreadsheet, and upload it again.',
  };
}
