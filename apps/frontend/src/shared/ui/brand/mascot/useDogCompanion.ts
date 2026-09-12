/*
 * useDogCompanion — connects a form to the Stayo dog.
 *
 *   const dog = useDogCompanion({ active: open });
 *   <StayoDog companion={dog.companion} framing="rim" />
 *   <input {...dog.bind.textField} />
 *   <div {...dog.bind.passwordGroup(shown)}>
 *     <input {...dog.bind.passwordInput} />
 *     <button {...dog.bind.revealButton} onClick={...; dog.setPasswordVisible(v)} />
 *   </div>
 *   {dog.capsLock && <p role="status">Caps Lock is on</p>}
 *   dog.submit(); dog.failed(); await dog.celebrate();
 *
 * Mood lives in a ref and the dog's frame loop reads it each frame through
 * `companion.read(now)`, so the dog costs the form no re-renders. The one
 * exception is `capsLock`, which is React state because the form shows it as
 * text (spec principle 4) — it changes only when Caps Lock does. The decisions themselves live
 * in the pure modules (`dogMood`, `dogGaze`, `dogMotionProfile`) and are
 * tested there; this file is event plumbing only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';

import type { DogExpressionName } from './dogExpressions';
import { caretTarget, chooseGaze, type DogGaze, type Point } from './dogGaze';
import { INITIAL_DOG_MOOD, dogMoodReducer, resolveExpression, type DogMoodEvent, type DogMoodState } from './dogMood';
import { dogMotionProfile, type DogMotionProfile } from './dogMotionProfile';
import { DOG_TUNING } from './dogTuning';

const IDLE_SLEEP_MS = DOG_TUNING.idleSleepS * 1000;

export interface DogFrame {
  expression: DogExpressionName;
  capsBrows: boolean;
  gaze: DogGaze;
  /** When the last failed login happened, for the head shake; 0 for never. */
  shakeAt: number;
}

/** What `StayoDog` reads each frame. */
export interface DogCompanion {
  read(now: number): DogFrame;
  profile(): DogMotionProfile;
  boop(): void;
}

/** Reads the device's motion profile right now. Safe outside a browser. */
export function readDogMotionProfile(): DogMotionProfile {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return dogMotionProfile({ pointerFine: false, reducedMotion: true });
  }
  return dogMotionProfile({
    pointerFine: window.matchMedia('(pointer: fine)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
}

function freshMood(now: number): DogMoodState {
  return { ...INITIAL_DOG_MOOD, lastActivityAt: now, idleSleepMs: IDLE_SLEEP_MS };
}

const measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

/** End of the typed text in a text input, in screen space. */
function caretOf(input: HTMLInputElement): Point {
  const cs = getComputedStyle(input);
  let textWidth = 0;
  if (measure) {
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    textWidth = measure.measureText(input.value).width;
  }
  return caretTarget(input.getBoundingClientRect(), {
    paddingLeft: parseFloat(cs.paddingLeft) || 0,
    paddingRight: parseFloat(cs.paddingRight) || 0,
    textWidth,
    scrollLeft: input.scrollLeft,
  });
}

function centerOf(el: Element): Point {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function useDogCompanion({ active }: { active: boolean }) {
  const mood = useRef<DogMoodState>(freshMood(0));
  const profile = useRef<DogMotionProfile>(readDogMotionProfile());
  const pointer = useRef<Point | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const shakeAt = useRef(0);
  const [capsLock, setCapsLock] = useState(false);

  // Each time the form opens, the dog starts fresh: awake, nothing focused.
  useEffect(() => {
    if (!active) return;
    mood.current = freshMood(performance.now());
    shakeAt.current = 0;
    setCapsLock(false);
    field.current = null;
    pointer.current = null;
    profile.current = readDogMotionProfile();

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (e.pointerType === 'touch') {
        mood.current = dogMoodReducer(mood.current, { type: 'activity', now });
        return;
      }
      pointer.current = { x: e.clientX, y: e.clientY };
      mood.current = dogMoodReducer(mood.current, { type: 'pointer', now });
    };
    const onActivity = () => {
      mood.current = dogMoodReducer(mood.current, { type: 'activity', now: performance.now() });
    };
    const queries = [window.matchMedia('(pointer: fine)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
    const onMedia = () => {
      profile.current = readDogMotionProfile();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    queries.forEach((q) => q.addEventListener('change', onMedia));
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      queries.forEach((q) => q.removeEventListener('change', onMedia));
    };
  }, [active]);

  // Everything returned is stable for the component's life: the handlers
  // close over refs, never over render-time values.
  const stable = useMemo(() => {
    const dispatch = (event: DogMoodEvent) => {
      mood.current = dogMoodReducer(mood.current, event);
    };

    const companion: DogCompanion = {
      read(now) {
        const p = profile.current;
        const { expression, capsBrows } = resolveExpression(mood.current, now, {
          trackPointer: p.trackPointer,
          idleSleepMs: IDLE_SLEEP_MS,
          errorHoldMs: DOG_TUNING.errorHoldMs,
        });
        const el = field.current;
        const focused = el !== null && el === document.activeElement;
        const gaze = chooseGaze(expression, {
          animate: p.animate,
          trackPointer: p.trackPointer,
          pointer: pointer.current,
          caret: focused && el.type !== 'password' ? caretOf(el) : null,
          fieldCenter: focused ? centerOf(el) : null,
        });
        return { expression, capsBrows, gaze, shakeAt: shakeAt.current };
      },
      profile: () => profile.current,
      boop: () => dispatch({ type: 'boop', now: performance.now() }),
    };

    const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => {
      if (typeof e.getModifierState !== 'function') return;
      const on = e.getModifierState('CapsLock');
      dispatch({ type: 'capsLock', on });
      setCapsLock(on);
    };

    const bind = {
      /** Any plain text field — email, name. The dog reads along. */
      textField: {
        onFocus: (e: FocusEvent<HTMLInputElement>) => {
          field.current = e.currentTarget;
          dispatch({ type: 'focus', field: 'text' });
        },
        onBlur: () => {
          if (mood.current.focus === 'text') dispatch({ type: 'focus', field: null });
        },
      },
      /**
       * The wrapper around a password input AND its show/hide button. Focus is
       * tracked on the wrapper so pressing "show" never counts as leaving the
       * field — the dog must not uncover its eyes mid-password. `visible` is
       * this field's own show/hide state: a form with two password fields
       * (password + confirm) reveals them separately.
       */
      passwordGroup: (visible: boolean) => ({
        onFocus: (e: FocusEvent<HTMLElement>) => {
          if (e.target instanceof HTMLInputElement) field.current = e.target;
          dispatch({ type: 'focus', field: 'password' });
          dispatch({ type: 'passwordVisible', visible });
        },
        onBlur: (e: FocusEvent<HTMLElement>) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          dispatch({ type: 'focus', field: null });
          setCapsLock(false);
        },
      }),
      passwordInput: { onKeyDown: checkCaps, onKeyUp: checkCaps },
      /** Keeps the caret in the password field when the button is pressed. */
      revealButton: { onMouseDown: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault() },
    };

    return {
      companion,
      bind,
      setPasswordVisible: (visible: boolean) => dispatch({ type: 'passwordVisible', visible }),
      submit: () => dispatch({ type: 'submit' }),
      failed: () => {
        const now = performance.now();
        shakeAt.current = now;
        dispatch({ type: 'failed', now });
      },
      /**
       * Celebrates, resolving after the one bounded success beat — immediately
       * under reduced motion, where there is nothing to watch.
       */
      celebrate: () =>
        new Promise<void>((resolve) => {
          dispatch({ type: 'succeeded' });
          window.setTimeout(resolve, profile.current.animate ? DOG_TUNING.successBeatMs : 0);
        }),
    };
  }, []);

  return { ...stable, capsLock };
}
