/**
 * What the owner sees while an import runs.
 *
 * Confirm is chunked — the client re-posts until nothing remains — so there is
 * a real numerator and denominator here, and the bar is determinate rather
 * than a spinner that says nothing. Three rules:
 *
 *  1. **Never claim completion early.** The batch stays PROCESSING until the
 *     last chunk; the copy must too, or an owner closes the tab on a
 *     half-finished import.
 *  2. **Name the stages in the owner's words** — rooms, tenants, payments,
 *     invitations — not the endpoints that produce them.
 *  3. **Say plainly that nothing has been sent.** Invitations are queued by
 *     design, and an owner who assumes their tenants were messaged will not
 *     go and send them.
 */

export interface ImportProgress {
  total: number;
  processed: number;
  remaining: number;
  succeeded: number;
  failed: number;
  stage: 'ROOMS' | 'TENANTS' | 'DONE';
}

export interface RoomOutcome {
  created: number;
  updated: number;
  errors: Array<{ room_no: string; error: string }>;
}

export interface ProgressView {
  percent: number;
  headline: string;
  lines: string[];
  /** True only when every row has been attempted. */
  done: boolean;
  /** Shown when the import finished with rows that could not be created. */
  failureNote: string | null;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
}

export function describeProgress(
  progress: ImportProgress | null | undefined,
  rooms?: RoomOutcome | null
): ProgressView {
  const total = Math.max(0, Number(progress?.total ?? 0));
  const processed = Math.min(Math.max(0, Number(progress?.processed ?? 0)), total);
  const succeeded = Math.max(0, Number(progress?.succeeded ?? 0));
  const failed = Math.max(0, Number(progress?.failed ?? 0));
  const remaining = Math.max(0, total - processed);
  const done = total > 0 && remaining === 0;

  const percent = total === 0 ? 0 : Math.round((processed / total) * 100);

  const lines: string[] = [];

  if (rooms && (rooms.created > 0 || rooms.updated > 0)) {
    const parts: string[] = [];
    if (rooms.created > 0) parts.push(`${count(rooms.created, 'room')} added`);
    if (rooms.updated > 0) parts.push(`${count(rooms.updated, 'room')} updated`);
    lines.push(parts.join(', '));
  }

  if (processed > 0) {
    lines.push(`${count(succeeded, 'tenant')} set up`);
  }
  if (failed > 0) {
    lines.push(`${count(failed, 'row')} couldn't be created`);
  }
  if (done) {
    // The one thing an owner will otherwise assume happened.
    lines.push('Invitations are ready to send — nobody has been messaged yet');
  }

  const headline = !total
    ? 'Getting ready…'
    : done
      ? failed > 0
        ? 'Import finished, with some rows left over'
        : 'Import complete'
      : `Setting up your tenants — ${processed.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`;

  return {
    percent,
    headline,
    lines,
    done,
    failureNote:
      done && failed > 0
        ? `${count(failed, 'row')} couldn't be created. Everything else is in — you can fix those and import them separately.`
        : null,
  };
}

/**
 * Whether the end of an import has earned the Stayo confirmation.
 *
 * Only a clean finish. The sound and the confetti say "everyone you imported
 * is in", and the owner will take them at their word — so a run where every
 * row failed (the owner's own first import: `succeeded: 0, failed: 1`) must
 * not celebrate, and nor may one where some rows failed, because the
 * confetti would drown out the list of people who did not make it.
 */
export function celebrationFor(progress: ImportProgress | null | undefined): { tenants: number } | null {
  if (!progress) return null;
  if (progress.stage !== 'DONE' || progress.remaining > 0) return null;
  if (progress.failed > 0 || progress.succeeded <= 0) return null;
  return { tenants: progress.succeeded };
}
