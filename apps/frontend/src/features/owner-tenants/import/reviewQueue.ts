/**
 * What the owner has to look at after uploading, and in what order.
 *
 * An import of a running hostel arrives with a handful of real problems buried
 * in a list of rows that are perfectly fine. The screen's whole job is to hide
 * the fine ones and put the rest in front of the owner one decision at a time.
 *
 * Two rules shape everything here:
 *
 *  1. **A row is a unit of attention, not an error.** A tenant with three
 *     things wrong is one card, not three.
 *  2. **A repeated problem is one decision.** A hostel that has been running
 *     three years hits the capped-backfill notice on nearly every row; asking
 *     thirty-two times is how an owner abandons the import. Grouping only
 *     offers "apply to all" where the fix is an acknowledgement — it can never
 *     mean "type the same room number into thirty-two rows".
 *
 * Pure, so the ordering and the grouping can be asserted without rendering
 * anything: the frontend suite is node-only.
 */

export type IssueSeverity = 'BLOCKER' | 'NEEDS_CHOICE' | 'NOTICE';

export interface RowIssue {
  code: string;
  severity: IssueSeverity;
  row: number;
  title: string;
  detail: string;
  field?: string;
  fix: { kind: string; options?: string[] };
}

export interface QueueRow {
  row: number;
  data: Record<string, unknown>;
  issues: RowIssue[];
}

export interface PreviewPayload {
  valid: QueueRow[];
  invalid: QueueRow[];
  duplicates: QueueRow[];
}

export interface IssueGroup {
  code: string;
  severity: IssueSeverity;
  /** The group's own heading — the count, not one row's specifics. */
  title: string;
  detail: string;
  rows: number[];
  count: number;
  /**
   * Whether one tap can settle the whole group. True only for an
   * acknowledgement: anything that needs a value typed or a room picked has to
   * be done per row, and pretending otherwise would import them wrong.
   */
  canApplyToAll: boolean;
}

export interface ReviewQueue {
  ready: QueueRow[];
  needsYou: QueueRow[];
  duplicates: QueueRow[];
  groups: IssueGroup[];
  summary: {
    ready: number;
    needsYou: number;
    duplicates: number;
    blockers: number;
    choices: number;
    /** False while anything blocks, or when there is nothing to import. */
    canImport: boolean;
  };
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  BLOCKER: 0,
  NEEDS_CHOICE: 1,
  NOTICE: 2,
};

function worstSeverity(row: QueueRow): IssueSeverity {
  return row.issues.reduce<IssueSeverity>(
    (worst, issue) => (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[worst] ? issue.severity : worst),
    'NOTICE'
  );
}

function byAttention(a: QueueRow, b: QueueRow): number {
  const severity = SEVERITY_ORDER[worstSeverity(a)] - SEVERITY_ORDER[worstSeverity(b)];
  // Within a severity, the owner's own row order — so they walk their
  // spreadsheet top to bottom rather than jumping around it.
  return severity !== 0 ? severity : a.row - b.row;
}

/** One tap can settle these; everything else needs the row in front of you. */
const ONE_TAP_FIXES = new Set(['ACKNOWLEDGE']);

function buildGroups(rows: QueueRow[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();

  for (const row of rows) {
    for (const issue of row.issues) {
      const existing = groups.get(issue.code);
      if (existing) {
        if (!existing.rows.includes(row.row)) existing.rows.push(row.row);
        existing.count = existing.rows.length;
        continue;
      }
      groups.set(issue.code, {
        code: issue.code,
        severity: issue.severity,
        title: issue.title,
        detail: issue.detail,
        rows: [row.row],
        count: 1,
        canApplyToAll: ONE_TAP_FIXES.has(issue.fix?.kind),
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => a - b),
      // A single row speaks for itself; "apply to all" over one row is noise.
      canApplyToAll: group.canApplyToAll && group.count > 1,
    }))
    // Biggest group first: settling it removes the most work in one tap.
    .sort((a, b) => b.count - a.count || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function buildReviewQueue(preview: PreviewPayload): ReviewQueue {
  const valid = preview.valid ?? [];
  const invalid = preview.invalid ?? [];
  const duplicates = preview.duplicates ?? [];

  const withIssues = [...valid, ...invalid].filter((row) => (row.issues ?? []).length > 0);
  const ready = valid.filter((row) => (row.issues ?? []).length === 0);
  const needsYou = [...withIssues].sort(byAttention);

  const allIssues = withIssues.flatMap((row) => row.issues);
  const blockers = allIssues.filter((i) => i.severity === 'BLOCKER').length;
  const choices = allIssues.filter((i) => i.severity === 'NEEDS_CHOICE').length;

  const importable = ready.length + needsYou.filter((row) => worstSeverity(row) !== 'BLOCKER').length;

  return {
    ready,
    needsYou,
    duplicates,
    groups: buildGroups(needsYou),
    summary: {
      ready: ready.length,
      needsYou: needsYou.length,
      duplicates: duplicates.length,
      blockers,
      choices,
      canImport: blockers === 0 && importable > 0,
    },
  };
}

/**
 * Settle a whole group at once.
 *
 * Only acknowledgements: a group that needs a room picked or a value typed is
 * returned untouched, because clearing it would tell the owner thirty-two
 * unknown rooms were resolved when nothing had been decided.
 */
export function applyGroupDecision(queue: ReviewQueue, code: string): ReviewQueue {
  const group = queue.groups.find((g) => g.code === code);
  if (!group || !ONE_TAP_FIXES.has(queue.needsYou.flatMap((r) => r.issues).find((i) => i.code === code)?.fix?.kind ?? '')) {
    return queue;
  }

  const rebuilt: PreviewPayload = {
    valid: [
      ...queue.ready,
      ...queue.needsYou.map((row) => ({ ...row, issues: row.issues.filter((issue) => issue.code !== code) })),
    ],
    invalid: [],
    duplicates: queue.duplicates,
  };

  // Rows that still carry something go back into needsYou; the rest become
  // ready. Rebuilding rather than mutating keeps this pure.
  const next = buildReviewQueue({
    valid: rebuilt.valid.filter((row) => row.issues.length === 0),
    invalid: rebuilt.valid.filter((row) => row.issues.length > 0),
    duplicates: rebuilt.duplicates,
  });

  return next;
}
