import { describe, expect, it } from 'vitest';
import { fromLocalInputValue, toLocalInputValue } from './votingWindow';

/**
 * These are timezone tests, but they pin no timezone: `process.env.TZ` is not
 * typed in this app's tsconfig and mutating it would leak across vitest's
 * workers. Every assertion below is instead written so it holds in *any* zone,
 * with the size of the old bug expressed as `getTimezoneOffset()` rather than
 * as a hard-coded 5h30m.
 */

describe('toLocalInputValue', () => {
  it('renders the local wall clock', () => {
    expect(toLocalInputValue(new Date(2026, 7, 9, 23, 0))).toBe('2026-08-09T23:00');
  });

  it('emits no zone marker and no seconds — the input accepts neither', () => {
    const value = toLocalInputValue(new Date(2026, 7, 9, 23, 0, 45, 123));
    expect(value).not.toContain('Z');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('zero-pads single-digit months, days, hours and minutes', () => {
    expect(toLocalInputValue(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07');
  });
});

describe('fromLocalInputValue', () => {
  it('reads the value as local time', () => {
    expect(fromLocalInputValue('2026-08-09T23:00').getTime()).toBe(new Date(2026, 7, 9, 23, 0).getTime());
  });

  it('is NaN for a value the input never produces', () => {
    expect(Number.isNaN(fromLocalInputValue('').getTime())).toBe(true);
  });
});

describe('round trip', () => {
  it('an untouched open-and-save does not move the instant', () => {
    const stored = new Date('2026-08-09T17:30:00.000Z');
    expect(fromLocalInputValue(toLocalInputValue(stored)).getTime()).toBe(stored.getTime());
  });

  it('does not drift when saved repeatedly', () => {
    // Two saves through the old prefill cost 11 hours in IST — enough to close
    // an open round outright.
    let instant = new Date('2026-08-09T17:30:00.000Z');
    for (let i = 0; i < 5; i++) instant = fromLocalInputValue(toLocalInputValue(instant));
    expect(instant.toISOString()).toBe('2026-08-09T17:30:00.000Z');
  });

  it('loses exactly the offset the UTC prefill used to lose, and loses none itself', () => {
    const stored = new Date('2026-08-09T17:30:00.000Z');
    // What `openEditWindow` used to write into the field: a UTC wall clock the
    // browser then read back as local.
    const viaUtcPrefill = fromLocalInputValue(stored.toISOString().slice(0, 16));
    expect(viaUtcPrefill.getTime() - stored.getTime()).toBe(stored.getTimezoneOffset() * 60_000);
    expect(fromLocalInputValue(toLocalInputValue(stored)).getTime() - stored.getTime()).toBe(0);
  });

  it('holds to the minute across a spread of instants', () => {
    for (const iso of ['2026-01-01T00:00:00.000Z', '2026-06-30T18:29:00.000Z', '2026-12-31T23:59:00.000Z']) {
      const d = new Date(iso);
      expect(fromLocalInputValue(toLocalInputValue(d)).getTime()).toBe(d.getTime());
    }
  });
});
