import { describe, expect, it } from 'vitest';
import { editCount, editRow, hasEdits, isEdited, mergeEdits, valueFor, type RowEdits } from './rowEdits';
import { buildReviewQueue } from './reviewQueue';

const row = (n: number, data: Record<string, unknown> = {}, issues: any[] = []) => ({
  row: n,
  data: { name: `Tenant ${n}`, phone: '98765', room_no: '101', ...data },
  issues,
});

const issue = (over: Partial<any> = {}) => ({
  code: 'PHONE_INVALID',
  severity: 'BLOCKER',
  row: 2,
  title: 't',
  detail: 'd',
  field: 'phone',
  fix: { kind: 'EDIT_FIELD' },
  ...over,
});

describe('editRow', () => {
  it('records a change without touching the row it amends', () => {
    const original = row(2);
    const edits = editRow({}, 2, 'phone', '9876500001');

    expect(edits[2].phone).toBe('9876500001');
    expect(original.data.phone).toBe('98765');
  });

  it('keeps earlier edits to the same row', () => {
    let edits: RowEdits = editRow({}, 2, 'phone', '9876500001');
    edits = editRow(edits, 2, 'room_no', '102');

    expect(edits[2]).toEqual({ phone: '9876500001', room_no: '102' });
  });

  it('is pure', () => {
    const before: RowEdits = {};
    editRow(before, 2, 'phone', '1');
    expect(before).toEqual({});
  });
});

describe('valueFor', () => {
  it('shows what the owner typed once they have typed it', () => {
    expect(valueFor(editRow({}, 2, 'phone', '9876500001'), row(2), 'phone')).toBe('9876500001');
  });

  it('falls back to what the sheet said', () => {
    expect(valueFor({}, row(2), 'phone')).toBe('98765');
  });

  it('shows an empty field rather than the word undefined', () => {
    expect(valueFor({}, row(2), 'email')).toBe('');
  });
});

describe('mergeEdits', () => {
  const queue = buildReviewQueue({
    valid: [row(3, { name: 'Fine' })],
    invalid: [row(2, {}, [issue()])],
    duplicates: [],
  });

  it('sends the whole batch, not just what changed', () => {
    // revalidate re-runs the batch; an untouched row left out would vanish.
    const merged = mergeEdits(queue, editRow({}, 2, 'phone', '9876500001'));
    expect(merged).toHaveLength(2);
  });

  it('keeps the owner\'s spreadsheet order', () => {
    const merged = mergeEdits(queue, {});
    expect(merged.map((r) => r.name)).toEqual(['Tenant 2', 'Fine']);
  });

  it('applies the edit', () => {
    const merged = mergeEdits(queue, editRow({}, 2, 'phone', '9876500001'));
    expect(merged[0].phone).toBe('9876500001');
  });

  it('treats an emptied field as no value, not an empty string', () => {
    const merged = mergeEdits(queue, editRow({}, 2, 'email', '   '));
    expect(merged[0].email).toBeUndefined();
  });

  it('leaves untouched rows exactly as they were', () => {
    const merged = mergeEdits(queue, editRow({}, 2, 'phone', '9876500001'));
    expect(merged[1]).toMatchObject({ name: 'Fine', phone: '98765' });
  });
});

describe('tracking what has been touched', () => {
  it('counts every field the owner changed', () => {
    let edits = editRow({}, 2, 'phone', '1');
    edits = editRow(edits, 3, 'room_no', '102');
    expect(editCount(edits)).toBe(2);
    expect(hasEdits(edits)).toBe(true);
  });

  it('knows nothing has been touched yet', () => {
    expect(hasEdits({})).toBe(false);
  });

  it('marks a row whose field the owner has just fixed', () => {
    // The server's issues do not move until the next re-check, so without this
    // a row the owner just corrected keeps shouting at them.
    const edits = editRow({}, 2, 'phone', '9876500001');
    expect(isEdited(edits, row(2), 'phone')).toBe(true);
    expect(isEdited(edits, row(2), 'room_no')).toBe(false);
    expect(isEdited(edits, row(3), 'phone')).toBe(false);
  });
});
