import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_DRAFT_KEY,
  DRAFT_SCHEMA_VERSION,
  serializeDraft,
  parseDraft,
  isDraftResumable,
} from './onboardingDraft';

const data = {
  name: 'Shiva',
  mobile: '918008046952',
  email: 'a@b.com',
  hostelName: 'Green Nest',
  type: 'Co-Living' as const,
  address: 'Yamnampet',
  city: 'Hyderabad',
  floors: 4,
  capacity: 100,
  food: 'Yes' as const,
  deposit: '8000',
  monthlyRent: '8000',
  roomsPerFloor: 10,
  bedsPerRoom: 4,
};

describe('serializeDraft', () => {
  // The single most important property here: a password must never reach
  // localStorage, where it would outlive the session in plain text.
  it('never persists a password, however it is passed in', () => {
    const raw = serializeDraft({ step: 2, data, password: 'Shiva@123', confirmPassword: 'Shiva@123' } as never);
    expect(raw).not.toContain('Shiva@123');
    expect(raw.toLowerCase()).not.toContain('password');
  });

  it('keeps the answers the owner actually typed', () => {
    const parsed = JSON.parse(serializeDraft({ step: 3, data }));
    expect(parsed.data.hostelName).toBe('Green Nest');
    expect(parsed.data.city).toBe('Hyderabad');
    expect(parsed.step).toBe(3);
  });

  it('stamps a schema version so a future shape change can be discarded safely', () => {
    expect(JSON.parse(serializeDraft({ step: 1, data })).version).toBe(DRAFT_SCHEMA_VERSION);
  });

  it('records when it was saved', () => {
    expect(typeof JSON.parse(serializeDraft({ step: 1, data })).savedAt).toBe('number');
  });
});

describe('parseDraft', () => {
  it('round-trips a draft it wrote itself', () => {
    const parsed = parseDraft(serializeDraft({ step: 4, data }));
    expect(parsed?.step).toBe(4);
    expect(parsed?.data.hostelName).toBe('Green Nest');
  });

  // A corrupt or hand-edited value must not white-screen the wizard.
  it('returns null for unparseable or non-object values rather than throwing', () => {
    for (const bad of ['', 'not json', '[]', 'null', '123', '{"no":"version"}']) {
      expect(() => parseDraft(bad)).not.toThrow();
      expect(parseDraft(bad)).toBeNull();
    }
  });

  it('discards a draft written by an older schema', () => {
    const stale = JSON.stringify({ version: DRAFT_SCHEMA_VERSION - 1, step: 3, data, savedAt: Date.now() });
    expect(parseDraft(stale)).toBeNull();
  });

  it('discards a draft whose data is not an object', () => {
    const bad = JSON.stringify({ version: DRAFT_SCHEMA_VERSION, step: 1, data: 'nope', savedAt: Date.now() });
    expect(parseDraft(bad)).toBeNull();
  });

  it('clamps a nonsensical step rather than jumping the wizard somewhere impossible', () => {
    const raw = JSON.stringify({ version: DRAFT_SCHEMA_VERSION, step: 999, data, savedAt: Date.now() });
    expect(parseDraft(raw)?.step).toBeLessThanOrEqual(8);
    const negative = JSON.stringify({ version: DRAFT_SCHEMA_VERSION, step: -5, data, savedAt: Date.now() });
    expect(parseDraft(negative)?.step).toBeGreaterThanOrEqual(0);
  });
});

describe('isDraftResumable', () => {
  const fresh = { version: DRAFT_SCHEMA_VERSION, step: 3, data, savedAt: Date.now() };

  it('offers to resume a draft with real progress', () => {
    expect(isDraftResumable(fresh)).toBe(true);
  });

  // Restoring someone onto step 0 with empty fields is not "resuming", it is
  // just noise — and the banner would be a lie.
  it('does not offer to resume an untouched draft at the first step', () => {
    expect(isDraftResumable({ ...fresh, step: 0, data: { ...data, hostelName: '', name: '', city: '', address: '' } })).toBe(false);
  });

  it('offers to resume step 0 if the owner actually typed something', () => {
    expect(isDraftResumable({ ...fresh, step: 0 })).toBe(true);
  });

  it('rejects null', () => {
    expect(isDraftResumable(null)).toBe(false);
  });
});

describe('storage key', () => {
  it('is namespaced so it cannot collide with another feature', () => {
    expect(ONBOARDING_DRAFT_KEY).toMatch(/^stayo\./);
  });
});
