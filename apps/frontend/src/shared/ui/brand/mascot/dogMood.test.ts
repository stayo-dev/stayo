import { describe, expect, it } from 'vitest';
import { INITIAL_DOG_MOOD, dogMoodReducer, resolveExpression, type DogMoodEvent, type DogMoodState } from './dogMood';

const CTX = { trackPointer: true, idleSleepMs: 30_000, errorHoldMs: 2_400 };
const T0 = 1_000_000;

/** Applies events in order, starting from a dog that just saw activity at T0. */
function after(...events: DogMoodEvent[]): DogMoodState {
  return events.reduce(dogMoodReducer, { ...INITIAL_DOG_MOOD, lastActivityAt: T0 });
}
const expr = (state: DogMoodState, now = T0 + 10) => resolveExpression(state, now, CTX).expression;

describe('resolveExpression — the resting rungs', () => {
  it('rests neutral when nothing is happening', () => {
    expect(expr(after())).toBe('neutral');
  });

  it('watches a moving cursor', () => {
    expect(expr(after({ type: 'pointer', now: T0 }))).toBe('attentive');
  });

  it('stops watching once the cursor has been still for a while', () => {
    expect(expr(after({ type: 'pointer', now: T0 }), T0 + 3_000)).toBe('neutral');
  });

  it('does not claim to watch a cursor it is not tracking (touch, reduced motion)', () => {
    const state = after({ type: 'pointer', now: T0 });
    expect(resolveExpression(state, T0 + 10, { ...CTX, trackPointer: false }).expression).toBe('neutral');
  });

  it('reads along when a text field has focus', () => {
    expect(expr(after({ type: 'focus', field: 'text' }))).toBe('reading');
  });

  it('dozes off after the idle timeout', () => {
    expect(expr(after(), T0 + 30_001)).toBe('sleepy');
  });

  it('wakes with a startle when activity arrives after a doze', () => {
    const state = after({ type: 'activity', now: T0 + 40_000 });
    expect(expr(state, T0 + 40_010)).toBe('curious');
    expect(expr(state, T0 + 41_000)).toBe('neutral');
  });

  it('does not startle on ordinary activity', () => {
    expect(expr(after({ type: 'activity', now: T0 + 5_000 }), T0 + 5_010)).toBe('neutral');
  });

  it('wags when booped', () => {
    const state = after({ type: 'boop', now: T0 });
    expect(expr(state, T0 + 100)).toBe('happy');
    expect(expr(state, T0 + 1_000)).toBe('neutral');
  });
});

describe('resolveExpression — the password promise', () => {
  it('covers its eyes while the password field has focus', () => {
    expect(expr(after({ type: 'focus', field: 'password' }))).toBe('covering');
  });

  it('peeks when the password is shown', () => {
    expect(expr(after({ type: 'focus', field: 'password' }, { type: 'passwordVisible', visible: true }))).toBe('peeking');
  });

  it('goes back to covering when the password is hidden again', () => {
    const state = after(
      { type: 'focus', field: 'password' },
      { type: 'passwordVisible', visible: true },
      { type: 'passwordVisible', visible: false },
    );
    expect(expr(state)).toBe('covering');
  });

  it('keeps covering rather than dozing off, however long the password takes', () => {
    expect(expr(after({ type: 'focus', field: 'password' }), T0 + 120_000)).toBe('covering');
  });

  it('keeps covering when booped mid-password', () => {
    expect(expr(after({ type: 'focus', field: 'password' }, { type: 'boop', now: T0 }), T0 + 100)).toBe('covering');
  });

  it('covers again straight away when the password is refocused during the sympathy hold', () => {
    const state = after({ type: 'failed', now: T0 }, { type: 'focus', field: 'password' });
    expect(expr(state, T0 + 500)).toBe('covering');
  });

  it('keeps covering after a failed login submitted from the password field', () => {
    // Enter in the password field: focus never leaves it, so the sympathy
    // hold must not uncover the eyes while the person retypes.
    const state = after({ type: 'focus', field: 'password' }, { type: 'submit' }, { type: 'failed', now: T0 });
    expect(expr(state, T0 + 100)).toBe('covering');
  });

  it('raises its brows for Caps Lock while covering', () => {
    const state = after({ type: 'focus', field: 'password' }, { type: 'capsLock', on: true });
    expect(resolveExpression(state, T0 + 10, CTX)).toEqual({ expression: 'covering', capsBrows: true });
  });

  it('ignores Caps Lock outside the password field', () => {
    const state = after({ type: 'focus', field: 'text' }, { type: 'capsLock', on: true });
    expect(resolveExpression(state, T0 + 10, CTX).capsBrows).toBe(false);
  });

  it('forgets Caps Lock when the password field loses focus', () => {
    const state = after({ type: 'focus', field: 'password' }, { type: 'capsLock', on: true }, { type: 'focus', field: null });
    expect(state.capsLock).toBe(false);
  });
});

describe('resolveExpression — the login outcome', () => {
  it('thinks while the login is in flight', () => {
    expect(expr(after({ type: 'submit' }))).toBe('thinking');
  });

  it('thinks even if the password field still has focus (Enter submits from it)', () => {
    expect(expr(after({ type: 'focus', field: 'password' }, { type: 'submit' }))).toBe('thinking');
  });

  it('shows sympathy after a failed login, for the hold only', () => {
    const state = after({ type: 'submit' }, { type: 'failed', now: T0 });
    expect(expr(state, T0 + 2_399)).toBe('concerned');
    expect(expr(state, T0 + 2_401)).toBe('neutral');
  });

  it('holds sympathy over reading when the failure came from the email field', () => {
    const state = after({ type: 'focus', field: 'text' }, { type: 'submit' }, { type: 'failed', now: T0 });
    expect(expr(state, T0 + 100)).toBe('concerned');
    expect(expr(state, T0 + 3_000)).toBe('reading');
  });

  it('ends the sympathy hold the moment a field is focused', () => {
    const state = after({ type: 'failed', now: T0 }, { type: 'focus', field: 'text' });
    expect(expr(state, T0 + 100)).toBe('reading');
  });

  it('celebrates a successful login', () => {
    expect(expr(after({ type: 'submit' }, { type: 'succeeded' }))).toBe('celebrating');
  });

  it('celebrates over everything else, the password field included', () => {
    expect(expr(after({ type: 'focus', field: 'password' }, { type: 'submit' }, { type: 'succeeded' }))).toBe('celebrating');
  });
});
