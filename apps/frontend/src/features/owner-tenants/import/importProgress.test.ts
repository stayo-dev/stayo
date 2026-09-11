import { describe, expect, it } from 'vitest';
import { describeProgress } from './importProgress';
import { celebrationFor } from './importProgress';

const progress = (over: Partial<Parameters<typeof describeProgress>[0]> = {}) => ({
  total: 60,
  processed: 25,
  remaining: 35,
  succeeded: 25,
  failed: 0,
  stage: 'TENANTS' as const,
  ...over,
});

describe('while the import is running', () => {
  it('gives a real proportion, not a spinner', () => {
    expect(describeProgress(progress()).percent).toBe(42);
  });

  it('says where it has got to, in the owner\'s numbers', () => {
    expect(describeProgress(progress()).headline).toContain('25 of 60');
  });

  it('never claims completion while rows remain', () => {
    const view = describeProgress(progress());
    expect(view.done).toBe(false);
    expect(view.headline).not.toMatch(/complete/i);
  });

  it('does not promise invitations have gone out', () => {
    expect(describeProgress(progress()).lines.join(' ')).not.toMatch(/messaged|sent/i);
  });
});

describe('when it finishes', () => {
  const finished = progress({ processed: 60, remaining: 0, succeeded: 60, stage: 'DONE' });

  it('says so, at 100%', () => {
    const view = describeProgress(finished);
    expect(view.done).toBe(true);
    expect(view.percent).toBe(100);
    expect(view.headline).toBe('Import complete');
  });

  it('tells the owner nobody has been messaged yet', () => {
    // Queued by design — an owner who assumes otherwise never sends them.
    expect(describeProgress(finished).lines.join(' ')).toContain('nobody has been messaged yet');
  });

  it('counts the rooms it created alongside the tenants', () => {
    const view = describeProgress(finished, { created: 12, updated: 2, errors: [] });
    expect(view.lines[0]).toBe('12 rooms added, 2 rooms updated');
  });

  it('says plainly when some rows did not make it, and that the rest did', () => {
    const view = describeProgress(progress({ processed: 60, remaining: 0, succeeded: 57, failed: 3, stage: 'DONE' }));
    expect(view.headline).toContain('with some rows left over');
    expect(view.failureNote).toContain("3 rows couldn't be created");
    expect(view.failureNote).toContain('Everything else is in');
  });
});

describe('edges', () => {
  it('does not divide by zero before the batch is known', () => {
    const view = describeProgress(null);
    expect(view.percent).toBe(0);
    expect(view.done).toBe(false);
    expect(view.headline).toBe('Getting ready…');
  });

  it('uses Indian digit grouping', () => {
    const view = describeProgress(progress({ total: 150, processed: 100, succeeded: 100 }));
    expect(view.headline).toContain('100 of 150');
  });

  it('says "1 tenant", not "1 tenants"', () => {
    const view = describeProgress(progress({ total: 1, processed: 1, remaining: 0, succeeded: 1, stage: 'DONE' }));
    expect(view.lines.join(' ')).toContain('1 tenant set up');
  });

  it('cannot report more processed than the batch holds', () => {
    expect(describeProgress(progress({ total: 10, processed: 999 })).percent).toBe(100);
  });
});

describe('celebrating the end of an import', () => {
  const done = (over: Partial<Parameters<typeof celebrationFor>[0] & object> = {}) => ({
    total: 1, processed: 1, remaining: 0, succeeded: 1, failed: 0, stage: 'DONE' as const, ...over,
  });

  it('celebrates a clean finish, and counts who made it', () => {
    expect(celebrationFor(done({ total: 12, processed: 12, succeeded: 12 }))).toEqual({ tenants: 12 });
  });

  /** The owner's own first run: the room was made, the tenant was not. */
  it('stays quiet when every row failed', () => {
    expect(celebrationFor(done({ succeeded: 0, failed: 1 }))).toBeNull();
  });

  it('stays quiet when some rows failed — the list of who did not make it matters more', () => {
    expect(celebrationFor(done({ total: 3, processed: 3, succeeded: 2, failed: 1 }))).toBeNull();
  });

  it('waits for the last chunk', () => {
    expect(celebrationFor(done({ remaining: 5, stage: 'TENANTS' }))).toBeNull();
  });

  it('says nothing before there is a result', () => {
    expect(celebrationFor(null)).toBeNull();
  });
});
