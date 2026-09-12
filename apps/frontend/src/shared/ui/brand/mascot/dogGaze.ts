/**
 * Where the Stayo dog looks, and where its paws land.
 *
 * Every point here is in the rig's own SVG space (the 300×300 art board);
 * the component converts screen points in with `getScreenCTM()` before
 * calling in. Screen-space helpers (`caretTarget`) say so.
 *
 * PURE — no DOM, runs under vitest's node environment.
 */
import type { DogExpressionName } from './dogExpressions';

export interface Point {
  x: number;
  y: number;
}

/**
 * Something to look at, tagged with its coordinate space: `screen` points
 * come from the page (cursor, a field) and are converted by the component;
 * `art` points are fixed places in the rig's own drawing.
 */
export type DogGaze = ({ space: 'screen' } & Point) | ({ space: 'art' } & Point) | null;

/** Up and to the right, into the thought bubble. */
export const THINKING_GAZE: DogGaze = { space: 'art', x: 205, y: 55 };
/** Down at the form below the dog. */
export const FORM_GAZE: DogGaze = { space: 'art', x: 150, y: 320 };

/**
 * What the dog looks at for an expression. Specific beats general: the
 * bubble while thinking, the typed text while reading, the password field
 * while peeking; then the cursor if it is tracking one; then the focused
 * field; then the form. Under reduced motion it holds one calm gaze at the
 * form rather than darting after every keystroke.
 */
export function chooseGaze(
  expression: DogExpressionName,
  input: { animate: boolean; trackPointer: boolean; pointer: Point | null; caret: Point | null; fieldCenter: Point | null },
): DogGaze {
  if (expression === 'covering' || expression === 'sleepy') return null;
  if (!input.animate) return FORM_GAZE;
  if (expression === 'thinking') return THINKING_GAZE;
  if (expression === 'reading' && input.caret) return { space: 'screen', ...input.caret };
  if (expression === 'peeking' && input.fieldCenter) return { space: 'screen', ...input.fieldCenter };
  if (input.trackPointer && input.pointer) return { space: 'screen', ...input.pointer };
  if (input.fieldCenter) return { space: 'screen', ...input.fieldCenter };
  return FORM_GAZE;
}

/** Centre of the head in the art: the head circle is `cx=150 cy=128`. */
const HEAD_X = 150;
/** Beyond this distance the pupils sit at full range; closer, they travel proportionally less. */
const PUPIL_FALLOFF = 120;
/** How quickly the head reaches its tilt limit as the target moves sideways. */
const TILT_FALLOFF = 260;

/** Offset of one pupil toward `target`, clamped to `maxRange`. */
export function pupilOffset(eye: Point, target: Point | null, maxRange: number): Point {
  if (!target) return { x: 0, y: 0 };
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0 };
  const m = maxRange * Math.min(1, d / PUPIL_FALLOFF);
  return { x: (dx / d) * m, y: (dy / d) * m };
}

/**
 * Head tilt, in degrees, toward a target — eased with `tanh` so a cursor at
 * the far edge of a wide screen tilts it no more than one near the card.
 */
export function headTiltFor(target: Point | null, maxDeg: number): number {
  if (!target) return 0;
  return maxDeg * Math.tanh((target.x - HEAD_X) / TILT_FALLOFF);
}

/**
 * The end of the typed text in a text input, in SCREEN space — what the dog
 * reads along to. `textWidth` is measured by the caller (canvas `measureText`
 * in the input's font); the rest comes from the input's box and padding.
 */
export function caretTarget(
  box: { left: number; top: number; width: number; height: number },
  field: { paddingLeft: number; paddingRight: number; textWidth: number; scrollLeft: number },
): Point {
  const inner = box.width - field.paddingLeft - field.paddingRight;
  const run = Math.min(Math.max(0, field.textWidth - field.scrollLeft), inner);
  return { x: box.left + field.paddingLeft + run, y: box.top + box.height / 2 };
}

/** Distance from the arm's origin up to the centre of its paw pad, in the arm's drawing. */
export const ARM_REACH = 104;
/** How far a lowered arm sinks along its own axis — far enough to vanish behind the rim. */
export const ARM_SINK = 130;

/**
 * Placement for one forearm. The arm is drawn upright with its paw pad
 * `ARM_REACH` above its origin; this returns the translate + rotate that
 * puts the pad on `(padX, padY)` when `raise` is 1, and slides the whole arm
 * down along its own lean as `raise` falls to 0 — so it always rises from
 * behind the card's rim like a front leg, never swings in from nowhere.
 */
export function armTransform(arm: { raise: number; lean: number; padX: number; padY: number }): {
  x: number;
  y: number;
  rotate: number;
} {
  const r = (arm.lean * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  const sink = (1 - arm.raise) * ARM_SINK;
  const baseX = arm.padX - ARM_REACH * s;
  const baseY = arm.padY + ARM_REACH * c;
  return { x: baseX - sink * s, y: baseY + sink * c, rotate: arm.lean };
}

/**
 * Milliseconds until the next blink: the base interval plus up to four
 * seconds of jitter, so blinking never falls into a noticeable rhythm.
 * `random` is `Math.random()` in production, a fixed value in tests.
 */
export function nextBlinkDelay(everyS: number, random: number): number {
  return (everyS + random * 4) * 1000;
}
