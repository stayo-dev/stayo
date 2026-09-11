import { describe, expect, it } from 'vitest';
import { applyGroupDecision, buildReviewQueue, type PreviewPayload } from './reviewQueue';

function issue(over: Partial<any> = {}) {
  return {
    code: 'PHONE_INVALID',
    severity: 'BLOCKER',
    row: 2,
    title: '"98765" isn\'t a 10-digit mobile number.',
    detail: 'Enter 10 digits.',
    field: 'phone',
    fix: { kind: 'EDIT_FIELD' },
    ...over,
  };
}

function row(n: number, issues: any[] = []) {
  return { row: n, data: { name: `Tenant ${n}`, room_no: '101' }, issues };
}

function preview(over: Partial<PreviewPayload> = {}): PreviewPayload {
  return { valid: [], invalid: [], duplicates: [], ...over };
}

describe('buildReviewQueue', () => {
  it('puts a clean batch entirely in ready', () => {
    const queue = buildReviewQueue(preview({ valid: [row(2), row(3)] }));

    expect(queue.ready).toHaveLength(2);
    expect(queue.needsYou).toEqual([]);
    expect(queue.groups).toEqual([]);
  });

  it('counts a row once, however many issues it has', () => {
    const queue = buildReviewQueue(
      preview({ invalid: [row(2, [issue(), issue({ code: 'ROOM_NOT_FOUND' })])] })
    );

    expect(queue.needsYou).toHaveLength(1);
    expect(queue.needsYou[0].issues).toHaveLength(2);
  });

  it('sorts rows that block above rows that only need a decision', () => {
    const queue = buildReviewQueue(
      preview({
        valid: [row(9, [issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: 9 })])],
        invalid: [row(4, [issue({ row: 4 })])],
      })
    );

    expect(queue.needsYou.map((r) => r.row)).toEqual([4, 9]);
  });

  it('orders by row number within the same severity, so the owner walks their sheet in order', () => {
    const queue = buildReviewQueue(
      preview({ invalid: [row(9, [issue({ row: 9 })]), row(4, [issue({ row: 4 })]), row(6, [issue({ row: 6 })])] })
    );

    expect(queue.needsYou.map((r) => r.row)).toEqual([4, 6, 9]);
  });

  it('keeps duplicates in their own bucket rather than mixed into the work', () => {
    const dup = row(5, [issue({ code: 'DUPLICATE_IN_SYSTEM', severity: 'NEEDS_CHOICE', row: 5, fix: { kind: 'OPEN_TENANT' } })]);
    const queue = buildReviewQueue(preview({ duplicates: [dup] }));

    expect(queue.duplicates).toHaveLength(1);
    expect(queue.needsYou).toEqual([]);
  });
});

describe('grouping, so one problem is one decision', () => {
  it('collects a repeated code into a single group naming every row', () => {
    const capped = (n: number) =>
      row(n, [issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: n, fix: { kind: 'ACKNOWLEDGE' } })]);
    const queue = buildReviewQueue(preview({ valid: [capped(2), capped(3), capped(9)] }));

    const group = queue.groups.find((g) => g.code === 'BACKFILL_CAPPED')!;
    expect(group.rows).toEqual([2, 3, 9]);
    expect(group.count).toBe(3);
  });

  it('offers apply-to-all only when the fix is an acknowledgement', () => {
    // "Apply to all" cannot mean "type the same room number into 32 rows".
    // Both groups have two rows, so only the fix kind separates them.
    const acknowledge = (n: number) =>
      row(n, [issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: n, fix: { kind: 'ACKNOWLEDGE' } })]);
    const pickRoom = (n: number) =>
      row(n, [issue({ code: 'ROOM_NOT_FOUND', row: n, fix: { kind: 'PICK_ROOM', options: ['101'] } })]);

    const queue = buildReviewQueue(
      preview({ valid: [acknowledge(2), acknowledge(3)], invalid: [pickRoom(4), pickRoom(5)] })
    );

    expect(queue.groups.find((g) => g.code === 'BACKFILL_CAPPED')!.canApplyToAll).toBe(true);
    expect(queue.groups.find((g) => g.code === 'ROOM_NOT_FOUND')!.canApplyToAll).toBe(false);
  });

  it('does not offer apply-to-all for a lone acknowledgement', () => {
    // One row settles itself; "apply to all 1" is noise.
    const queue = buildReviewQueue(
      preview({ valid: [row(2, [issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: 2, fix: { kind: 'ACKNOWLEDGE' } })])] })
    );

    expect(queue.groups[0].canApplyToAll).toBe(false);
  });

  it('sorts groups by how many rows they hold, so the biggest win is first', () => {
    const capped = (n: number) => row(n, [issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: n, fix: { kind: 'ACKNOWLEDGE' } })]);
    const phone = (n: number) => row(n, [issue({ row: n })]);

    const queue = buildReviewQueue(preview({ valid: [capped(2), capped(3), capped(4)], invalid: [phone(5)] }));

    expect(queue.groups.map((g) => g.code)).toEqual(['BACKFILL_CAPPED', 'PHONE_INVALID']);
  });

  it('does not group a code that appears once — a single row speaks for itself', () => {
    const queue = buildReviewQueue(preview({ invalid: [row(2, [issue()])] }));

    expect(queue.groups[0].count).toBe(1);
    expect(queue.groups[0].canApplyToAll).toBe(false);
  });
});

describe('applyGroupDecision', () => {
  const capped = (n: number) =>
    row(n, [issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: n, fix: { kind: 'ACKNOWLEDGE' } })]);

  it('clears the acknowledged issue from every row in the group', () => {
    const queue = buildReviewQueue(preview({ valid: [capped(2), capped(3), capped(9)] }));
    const after = applyGroupDecision(queue, 'BACKFILL_CAPPED');

    expect(after.needsYou).toEqual([]);
    expect(after.ready).toHaveLength(3);
  });

  it('leaves a row alone if it still has another issue', () => {
    const both = row(2, [
      issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: 2, fix: { kind: 'ACKNOWLEDGE' } }),
      issue({ row: 2 }),
    ]);
    const queue = buildReviewQueue(preview({ invalid: [both] }));

    const after = applyGroupDecision(queue, 'BACKFILL_CAPPED');

    expect(after.needsYou).toHaveLength(1);
    expect(after.needsYou[0].issues.map((i) => i.code)).toEqual(['PHONE_INVALID']);
  });

  it('refuses to acknowledge a group that needs a real edit', () => {
    const queue = buildReviewQueue(
      preview({ invalid: [row(2, [issue({ code: 'ROOM_NOT_FOUND', row: 2, fix: { kind: 'PICK_ROOM' } })])] })
    );

    const after = applyGroupDecision(queue, 'ROOM_NOT_FOUND');

    // Unchanged: pretending 32 unknown rooms are resolved would import them wrong.
    expect(after.needsYou).toHaveLength(1);
  });

  it('is pure — the original queue is untouched', () => {
    const queue = buildReviewQueue(preview({ valid: [capped(2)] }));
    applyGroupDecision(queue, 'BACKFILL_CAPPED');

    expect(queue.needsYou).toHaveLength(1);
  });
});

describe('what the owner is told at a glance', () => {
  it('summarises the three buckets', () => {
    const queue = buildReviewQueue(
      preview({
        valid: [row(2), row(3)],
        invalid: [row(4, [issue({ row: 4 })])],
        duplicates: [row(5, [issue({ code: 'DUPLICATE_IN_FILE', severity: 'NEEDS_CHOICE', row: 5 })])],
      })
    );

    expect(queue.summary).toMatchObject({ ready: 2, needsYou: 1, duplicates: 1 });
  });

  it('knows when nothing can be imported yet', () => {
    const queue = buildReviewQueue(preview({ invalid: [row(2, [issue()])] }));
    expect(queue.summary.canImport).toBe(false);
  });

  it('lets the owner import while only choices remain', () => {
    // A capped-backfill row still imports; it is a decision, not a blocker.
    const queue = buildReviewQueue(
      preview({ valid: [row(2, [issue({ code: 'BACKFILL_CAPPED', severity: 'NEEDS_CHOICE', row: 2, fix: { kind: 'ACKNOWLEDGE' } })])] })
    );

    expect(queue.summary.canImport).toBe(true);
  });

  it('will not import an empty batch', () => {
    expect(buildReviewQueue(preview()).summary.canImport).toBe(false);
  });
});
