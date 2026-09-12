/**
 * What the Stayo dog is feeling, decided from what the person is doing.
 *
 * Every reaction traces to a user action (principle 2 of the spec): the form
 * reports events, this reducer folds them into state, and
 * `resolveExpression` picks ONE expression by walking a priority ladder,
 * highest first:
 *
 *   success › submitting › password (covering / peeking) › error hold ›
 *   boop › startle › reading › sleepy › attentive › neutral
 *
 * The password rung outranks the error hold on purpose: covering its eyes on
 * the password IS the privacy message, so nothing may interrupt it. Focusing
 * any field also ends the hold outright.
 *
 * Timers are timestamps compared against `now`, so all of this is testable
 * without a clock.
 *
 * PURE — no DOM, runs under vitest's node environment.
 */
import type { DogExpressionName } from './dogExpressions';

/** How long a wake-up startle shows before the dog settles. */
export const STARTLE_MS = 550;
/** How long a boop keeps the dog wagging. */
export const BOOP_MS = 800;
/** How long after the cursor stops the dog keeps watching it. */
export const POINTER_ATTENTION_MS = 2_500;

export type DogField = 'text' | 'password' | null;
export type DogPhase = 'idle' | 'submitting' | 'error' | 'success';

export interface DogMoodState {
  focus: DogField;
  passwordVisible: boolean;
  capsLock: boolean;
  phase: DogPhase;
  errorAt: number;
  lastActivityAt: number;
  lastPointerAt: number;
  startleUntil: number;
  boopUntil: number;
  /** Idle timeout, so the reducer can tell a wake-up from ordinary activity. */
  idleSleepMs: number;
}

export const INITIAL_DOG_MOOD: DogMoodState = {
  focus: null,
  passwordVisible: false,
  capsLock: false,
  phase: 'idle',
  errorAt: 0,
  lastActivityAt: 0,
  lastPointerAt: Number.NEGATIVE_INFINITY,
  startleUntil: 0,
  boopUntil: 0,
  idleSleepMs: 30_000,
};

export type DogMoodEvent =
  | { type: 'focus'; field: DogField }
  | { type: 'passwordVisible'; visible: boolean }
  | { type: 'capsLock'; on: boolean }
  | { type: 'submit' }
  | { type: 'failed'; now: number }
  | { type: 'succeeded' }
  | { type: 'activity'; now: number }
  | { type: 'pointer'; now: number }
  | { type: 'boop'; now: number };

function withActivity(state: DogMoodState, now: number): DogMoodState {
  const wasAsleep = now - state.lastActivityAt > state.idleSleepMs;
  return { ...state, lastActivityAt: now, startleUntil: wasAsleep ? now + STARTLE_MS : state.startleUntil };
}

export function dogMoodReducer(state: DogMoodState, event: DogMoodEvent): DogMoodState {
  switch (event.type) {
    case 'focus':
      return {
        ...state,
        focus: event.field,
        // Leaving the password field makes the Caps Lock reading stale.
        capsLock: event.field === 'password' ? state.capsLock : false,
        // Getting back to work ends the sympathy hold.
        phase: event.field !== null && state.phase === 'error' ? 'idle' : state.phase,
      };
    case 'passwordVisible':
      return { ...state, passwordVisible: event.visible };
    case 'capsLock':
      return { ...state, capsLock: event.on };
    case 'submit':
      return { ...state, phase: 'submitting' };
    case 'failed':
      return { ...state, phase: 'error', errorAt: event.now };
    case 'succeeded':
      return { ...state, phase: 'success' };
    case 'activity':
      return withActivity(state, event.now);
    case 'pointer':
      return { ...withActivity(state, event.now), lastPointerAt: event.now };
    case 'boop':
      return { ...withActivity(state, event.now), boopUntil: event.now + BOOP_MS };
  }
}

export interface DogMoodContext {
  /** From `dogMotionProfile` — false on touch and under reduced motion. */
  trackPointer: boolean;
  idleSleepMs: number;
  errorHoldMs: number;
}

export interface ResolvedExpression {
  expression: DogExpressionName;
  /**
   * Caps Lock is on in the password field: raise the brows. A modifier, not a
   * rung — above the paws, the brows are the only part of the face showing.
   */
  capsBrows: boolean;
}

export function resolveExpression(state: DogMoodState, now: number, ctx: DogMoodContext): ResolvedExpression {
  const onPassword = state.focus === 'password';
  const capsBrows = onPassword && state.capsLock;
  const pick = (expression: DogExpressionName): ResolvedExpression => ({ expression, capsBrows });

  if (state.phase === 'success') return pick('celebrating');
  if (state.phase === 'submitting') return pick('thinking');
  if (onPassword) return pick(state.passwordVisible ? 'peeking' : 'covering');
  if (state.phase === 'error' && now - state.errorAt < ctx.errorHoldMs) return pick('concerned');
  if (now < state.boopUntil) return pick('happy');
  if (now < state.startleUntil) return pick('curious');
  if (state.focus === 'text') return pick('reading');
  if (now - state.lastActivityAt > ctx.idleSleepMs) return pick('sleepy');
  if (ctx.trackPointer && now - state.lastPointerAt < POINTER_ATTENTION_MS) return pick('attentive');
  return pick('neutral');
}
