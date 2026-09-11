/**
 * How an issue is rendered as something the owner can act on.
 *
 * The backend already writes the sentence — it knows the real room number, the
 * real hostel and the real rupee amount, and it writes them in Indian formats.
 * This module never rewrites that copy. It decides only what the *control*
 * beside it is, and what a group of the same problem should be called.
 *
 * Keeping it here, rather than in a component, is what lets the wording be
 * asserted: the frontend suite renders nothing.
 */

import type { IssueGroup, RowIssue } from './reviewQueue';

export type ControlKind = 'text' | 'room' | 'option' | 'date' | 'acknowledge' | 'skip' | 'link';

export interface IssueControl {
  kind: ControlKind;
  /** The button or field label. */
  label: string;
  /** Choices for a picker, when the backend supplied them. */
  options: string[];
  /** Which row field the control edits, when it edits one. */
  field: string | null;
}

const CONTROLS: Record<string, { kind: ControlKind; label: string }> = {
  EDIT_FIELD: { kind: 'text', label: 'Fix it' },
  PICK_ROOM: { kind: 'room', label: 'Choose a room' },
  PICK_OPTION: { kind: 'option', label: 'Choose' },
  PICK_DATE: { kind: 'date', label: 'Pick the date' },
  ACKNOWLEDGE: { kind: 'acknowledge', label: 'Got it' },
  SKIP_ROW: { kind: 'skip', label: 'Skip this row' },
  OPEN_TENANT: { kind: 'link', label: 'Open their profile' },
};

export function controlFor(issue: RowIssue): IssueControl {
  const control = CONTROLS[issue.fix?.kind] ?? CONTROLS.EDIT_FIELD;
  return {
    kind: control.kind,
    label: control.label,
    options: issue.fix?.options ?? [],
    field: issue.field ?? null,
  };
}

/**
 * The one-tap action offered for a whole group, or null when there isn't one.
 *
 * Only acknowledgements get this. Anything needing a value typed or a room
 * chosen has to be done per row — see `reviewQueue`.
 */
export function groupAction(group: IssueGroup): { label: string; note: string } | null {
  if (!group.canApplyToAll) return null;
  return {
    label: `Understood — apply to all ${group.count.toLocaleString('en-IN')}`,
    note: `This settles ${group.count.toLocaleString('en-IN')} rows at once. You can still change any of them afterwards.`,
  };
}

/** "2 rows need you" / "Everything looks right" — the line above the list. */
export function attentionSummary(counts: { needsYou: number; ready: number; duplicates: number }): string {
  const parts: string[] = [];
  if (counts.ready > 0) parts.push(`${counts.ready.toLocaleString('en-IN')} ready`);
  if (counts.needsYou > 0) parts.push(`${counts.needsYou.toLocaleString('en-IN')} need you`);
  if (counts.duplicates > 0) {
    parts.push(
      `${counts.duplicates.toLocaleString('en-IN')} already ${counts.duplicates === 1 ? 'here' : 'here'}`
    );
  }
  return parts.length ? parts.join(' · ') : 'Nothing to import yet';
}
