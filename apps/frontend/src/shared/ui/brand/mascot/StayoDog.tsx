/*
 * StayoDog — the brand mascot, alive.
 *
 *   <StayoDog companion={dog.companion} framing="rim" />   reacts to a form
 *   <StayoDog expression="waving" />                       holds one expression
 *
 * One rig, one frame loop. Each frame it asks the companion what the dog
 * feels and where it looks, works out where every part is heading
 * (`rigTargets`), springs each part toward it (`stepSpring`) and writes SVG
 * transforms straight onto the parts. React renders the artwork once; the
 * loop never causes a render.
 *
 * Decorative by contract (spec principle 4): `aria-hidden`, never focusable,
 * and nothing it expresses is not also said in text. Under reduced motion
 * every spring snaps to its target, so the dog still changes pose (it still
 * covers its eyes) without anything moving.
 *
 * Framing:
 *   `rim`  — leans over the top edge of a card. Sit the SVG's bottom on the
 *            card's top edge, then push it down by RIM_OVERLAP_PERCENT of its
 *            own height (`translateY`), so the paws straddle the edge.
 *   `full` — the whole dog, standing.
 */
import { useId, useLayoutEffect, useMemo, useRef } from 'react';

import { cn } from '@shared/lib/cn';

import { DOG_EXPRESSIONS, type DogExpression, type DogExpressionName } from './dogExpressions';
import { armTransform, nextBlinkDelay, type DogGaze, type Point } from './dogGaze';
import { DogArt, RIM_Y, type DogFraming } from './dogParts';
import { REST_ARMS, rigTargets, type RigTargets } from './dogRig';
import { stepSpring, type SpringState } from './dogSpring';
import { DOG_TUNING } from './dogTuning';
import { readDogMotionProfile, type DogCompanion } from './useDogCompanion';

import './stayo-dog.css';

const VIEWBOX = { rim: { y: 8, h: 218 }, full: { y: 0, h: 300 } } as const;

/**
 * In `rim` framing, how far the SVG hangs below the card's top edge, as a
 * percentage of its own height: the rim line (art y 214) sits 12 units above
 * the bottom of the 218-unit-tall view box.
 */
export const RIM_OVERLAP_PERCENT = ((VIEWBOX.rim.y + VIEWBOX.rim.h - RIM_Y) / VIEWBOX.rim.h) * 100;

/** How far below the rim the dog starts its entrance, in art units. */
const RISE_FROM = 84;
/** How often the SVG's screen transform is re-read; it only moves on layout changes. */
const CTM_REFRESH_MS = 200;

type StayoDogProps = { framing?: DogFraming; className?: string } & (
  | { companion: DogCompanion; expression?: undefined }
  | { expression: DogExpressionName; companion?: undefined }
);

type SpringKey =
  | 'rot' | 'hx' | 'hy' | 'plx' | 'ply' | 'prx' | 'pry' | 'earL' | 'earR' | 'eye'
  | 'lRaise' | 'lLean' | 'lX' | 'lY' | 'rRaise' | 'rLean' | 'rX' | 'rY' | 'rise';

/** Which spring family each value belongs to — they differ in stiffness and damping. */
const SPRING_FAMILY: Record<SpringKey, 'head' | 'pupil' | 'ear' | 'paw' | 'rise'> = {
  rot: 'head', hx: 'head', hy: 'head', eye: 'head',
  plx: 'pupil', ply: 'pupil', prx: 'pupil', pry: 'pupil',
  earL: 'ear', earR: 'ear',
  lRaise: 'paw', lLean: 'paw', lX: 'paw', lY: 'paw', rRaise: 'paw', rLean: 'paw', rX: 'paw', rY: 'paw',
  rise: 'rise',
};

/** [stiffness, damping ratio] per family. Pupils are quicker than the head; ears lag behind it. */
function springParams(family: (typeof SPRING_FAMILY)[SpringKey]): [number, number] {
  const { headStiffness, headDamping, earFollow, pawStiffness } = DOG_TUNING;
  switch (family) {
    case 'head':
      return [headStiffness, headDamping];
    case 'pupil':
      return [headStiffness * 1.8, 0.8];
    case 'ear':
      return [headStiffness * earFollow, 0.5];
    case 'paw':
      return [pawStiffness, 0.82];
    case 'rise':
      return [170, 0.55];
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function StayoDog({ framing = 'full', className, companion, expression }: StayoDogProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = `stayo-dog-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const staticExpression = useRef<DogExpressionName>(expression ?? 'neutral');
  staticExpression.current = expression ?? 'neutral';

  const source = useMemo<DogCompanion>(() => {
    if (companion) return companion;
    const profile = readDogMotionProfile();
    return {
      read: () => ({ expression: staticExpression.current, capsBrows: false, gaze: { space: 'art', x: 150, y: 230 }, shakeAt: 0 }),
      profile: () => profile,
      boop: () => {},
    };
  }, [companion]);

  // Layout effect: the first frame is applied before paint, so the artwork
  // never flashes every variant at once.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const part = (name: string) => svg.querySelector<SVGGElement>(`[data-part="${name}"]`);
    const el = {
      rise: part('rise'), torso: part('torso'), head: part('head'), earL: part('ear-l'), earR: part('ear-r'),
      ballL: part('ball-l'), ballR: part('ball-r'), tailPivot: part('tail-pivot'), armL: part('arm-l'), armR: part('arm-r'),
      rimPaws: part('rim-paws'), bubble: part('bubble'), sparkles: part('sparkles'), zzz: part('zzz'),
    };
    const variantParts = ['brows', 'mouth', 'tail', 'ear-l', 'ear-r', 'eye-l', 'eye-r'].map((n) => [n, part(n)] as const);

    const animateAtStart = source.profile().animate;
    const springs = {} as Record<SpringKey, SpringState>;
    const spring = (key: SpringKey, x: number) => (springs[key] = { x, v: 0 });
    (['rot', 'hx', 'hy', 'plx', 'ply', 'prx', 'pry', 'earL', 'earR'] as const).forEach((k) => spring(k, 0));
    spring('eye', 1);
    spring('lRaise', 0); spring('lLean', REST_ARMS.l.lean); spring('lX', REST_ARMS.l.padX); spring('lY', REST_ARMS.l.padY);
    spring('rRaise', 0); spring('rLean', REST_ARMS.r.lean); spring('rX', REST_ARMS.r.padX); spring('rY', REST_ARMS.r.padY);
    spring('rise', framing === 'rim' && animateAtStart ? RISE_FROM : 0);

    let arms: RigTargets['arms'] = REST_ARMS;
    let shown: string | null = null;
    let nextBlink = performance.now() + nextBlinkDelay(DOG_TUNING.blinkEveryS, Math.random());
    let blinkUntil = 0;
    let ctm: DOMMatrix | null = null;
    let ctmAt = -Infinity;
    let last = performance.now();
    let raf = 0;

    const showVariant = (group: SVGGElement | null, value: string) => {
      if (!group) return;
      for (const child of Array.from(group.children) as SVGElement[]) {
        const v = child.dataset.v;
        if (v !== undefined) child.style.display = v === value ? '' : 'none';
      }
    };
    const show = (node: SVGGElement | null, on: boolean) => {
      if (node) node.style.display = on ? '' : 'none';
    };

    const toArt = (gaze: DogGaze, now: number): Point | null => {
      if (!gaze) return null;
      if (gaze.space === 'art') return gaze;
      if (now - ctmAt > CTM_REFRESH_MS) {
        ctm = svg.getScreenCTM();
        ctmAt = now;
      }
      if (!ctm) return null;
      const p = new DOMPoint(gaze.x, gaze.y).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const { expression: name, capsBrows, gaze, shakeAt } = source.read(now);
      const { animate } = source.profile();
      const E: DogExpression = DOG_EXPRESSIONS[name];

      const key = `${name}|${capsBrows}`;
      if (key !== shown) {
        shown = key;
        for (const [n, group] of variantParts) {
          if (n === 'brows') showVariant(group, capsBrows ? 'raised' : E.brows);
          else if (n === 'mouth') showVariant(group, E.mouth);
          else if (n === 'tail') showVariant(group, E.tail);
          else if (n === 'ear-l' || n === 'ear-r') showVariant(group, E.ears === 'perk' ? 'perk' : 'rest');
          else if (n === 'eye-l') showVariant(group, E.eyes === 'peek' ? 'closed' : E.eyes);
          else if (n === 'eye-r') showVariant(group, E.eyes === 'peek' ? 'open' : E.eyes);
        }
        show(el.bubble, E.extra === 'bubble');
        show(el.sparkles, E.extra === 'sparkles');
        show(el.zzz, E.extra === 'zzz');
        // Over the rim only a raised tail clears the card edge; a lower one
        // would poke out beside the shoulder as a stray spike.
        if (framing === 'rim') show(el.tailPivot, E.tail === 'high');
      }

      const t = rigTargets(E, toArt(gaze, now), DOG_TUNING, arms);
      arms = t.arms;
      const targets: Record<SpringKey, number> = {
        rot: t.headRotate, hx: t.headX, hy: t.headY,
        plx: t.pupils.l.x, ply: t.pupils.l.y, prx: t.pupils.r.x, pry: t.pupils.r.y,
        earL: springs.rot.x + t.earSpread, earR: springs.rot.x - t.earSpread, eye: t.eyeScale,
        lRaise: t.arms.l.raise, lLean: t.arms.l.lean, lX: t.arms.l.padX, lY: t.arms.l.padY,
        rRaise: t.arms.r.raise, rLean: t.arms.r.lean, rX: t.arms.r.padX, rY: t.arms.r.padY,
        rise: 0,
      };
      for (const k of Object.keys(springs) as SpringKey[]) {
        if (!animate) {
          springs[k] = { x: targets[k], v: 0 };
          continue;
        }
        const [stiffness, damping] = springParams(SPRING_FAMILY[k]);
        springs[k] = stepSpring(springs[k], targets[k], stiffness, damping, dt);
      }
      const s = (k: SpringKey) => springs[k].x;

      let blink = 1;
      if (animate && (E.eyes === 'open' || E.eyes === 'peek')) {
        if (now > nextBlink) {
          blinkUntil = now + 130;
          nextBlink = now + nextBlinkDelay(DOG_TUNING.blinkEveryS, Math.random());
        }
        if (now < blinkUntil) blink = 0.12;
      }
      const sinceShake = (now - shakeAt) / 1000;
      const shake = animate && shakeAt > 0 && sinceShake < 1 ? 7 * Math.sin(sinceShake * 2 * Math.PI * 4.5) * Math.exp(-sinceShake * 5) : 0;
      const breath = animate ? 0.9 * Math.sin((now / 1000) * 2 * Math.PI * 0.25) : 0;
      const wag = animate ? E.wag * 11 * Math.sin((now / 1000) * 2 * Math.PI * DOG_TUNING.wagHz) : 0;
      const wave = animate && E.arms[1] === 'wave' ? 14 * Math.sin((now / 1000) * 2 * Math.PI * 2) : 0;

      const f = (n: number) => n.toFixed(2);
      el.rise?.setAttribute('transform', `translate(0 ${f(s('rise'))})`);
      el.torso?.setAttribute('transform', `translate(0 ${f(breath * 0.4)})`);
      el.head?.setAttribute('transform', `translate(${f(s('hx'))} ${f(s('hy') + breath * 0.7)}) rotate(${f(s('rot') + shake)} 150 150)`);
      el.earL?.setAttribute('transform', `rotate(${f(s('earL') - s('rot'))} 100 92)`);
      el.earR?.setAttribute('transform', `rotate(${f(s('earR') - s('rot'))} 200 92)`);
      const eye = (ox: number, oy: number, cx: number) =>
        `translate(${f(ox)} ${f(oy)}) translate(${cx} 112) scale(${s('eye').toFixed(3)} ${(s('eye') * blink).toFixed(3)}) translate(${-cx} -112)`;
      el.ballL?.setAttribute('transform', eye(s('plx'), s('ply'), 130));
      el.ballR?.setAttribute('transform', eye(s('prx'), s('pry'), 170));
      el.tailPivot?.setAttribute('transform', `rotate(${f(wag)} 210 262)`);

      const arm = (raise: number, lean: number, padX: number, padY: number) => {
        const a = armTransform({ raise, lean, padX, padY });
        return `translate(${f(a.x)} ${f(a.y)}) rotate(${f(a.rotate)})`;
      };
      el.armL?.setAttribute('transform', arm(s('lRaise'), s('lLean'), s('lX'), s('lY')));
      el.armR?.setAttribute('transform', arm(s('rRaise'), s('rLean') + wave, s('rX'), s('rY')));
      if (framing === 'full') {
        if (el.armL) el.armL.style.opacity = String(clamp01(s('lRaise') * 3));
        if (el.armR) el.armR.style.opacity = String(clamp01(s('rRaise') * 3));
      }
      if (el.rimPaws) {
        // A paw lifting off the rim becomes the paw rising over the eyes.
        const settled = clamp01(1 - s('rise') / 30);
        const [pl, pr] = Array.from(el.rimPaws.children) as SVGElement[];
        pl.style.opacity = (clamp01(1 - s('lRaise') * 1.6) * settled).toFixed(3);
        pr.style.opacity = (clamp01(1 - s('rRaise') * 1.6) * settled).toFixed(3);
      }
    };

    frame(performance.now());
    const loop = (now: number) => {
      frame(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [source, framing]);

  const box = VIEWBOX[framing];
  return (
    <svg
      ref={svgRef}
      viewBox={`0 ${box.y} 300 ${box.h}`}
      aria-hidden="true"
      focusable="false"
      className={cn('pointer-events-none block h-auto w-full overflow-visible', className)}
    >
      <DogArt clipId={clipId} framing={framing} />
      {companion && (
        // The boop target: pointer-only by design. A tab stop on a decorative
        // dog inside a login form would cost keyboard users a keystroke.
        <circle
          cx={150}
          cy={128}
          r={70}
          fill="transparent"
          className="pointer-events-auto cursor-pointer"
          onPointerDown={() => companion.boop()}
        />
      )}
    </svg>
  );
}
