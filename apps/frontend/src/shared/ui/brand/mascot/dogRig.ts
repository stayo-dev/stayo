/**
 * Where every moving part of the Stayo dog is heading, for one expression
 * and one gaze target. The frame loop in `StayoDog.tsx` springs each part
 * toward these targets; this module decides them.
 *
 * PURE — no DOM, runs under vitest's node environment.
 */
import { ARM_POSES, EYE_CENTERS, type DogExpression } from './dogExpressions';
import { headTiltFor, pupilOffset, type Point } from './dogGaze';

export interface ArmTarget {
  /** 1 is fully raised onto its pad target; 0 is sunk behind the rim. */
  raise: number;
  lean: number;
  padX: number;
  padY: number;
}

export interface RigTargets {
  pupils: { l: Point; r: Point };
  headRotate: number;
  headX: number;
  headY: number;
  /** Ear rotation away from the head, degrees: positive droops outward, negative perks inward. */
  earSpread: number;
  eyeScale: number;
  arms: { l: ArmTarget; r: ArmTarget };
}

/** Both arms lowered, leaning as if they would rise to cover the eyes. */
export const REST_ARMS: RigTargets['arms'] = {
  l: { raise: 0, lean: ARM_POSES.l.cover.lean, padX: ARM_POSES.l.cover.x, padY: ARM_POSES.l.cover.y },
  r: { raise: 0, lean: ARM_POSES.r.cover.lean, padX: ARM_POSES.r.cover.x, padY: ARM_POSES.r.cover.y },
};

const HEAD_CENTER = { x: 150, y: 130 };
const EAR_SPREAD = { rest: 0, perk: -5, droop: 12 } as const;

function armTarget(side: 'l' | 'r', pose: string, previous: ArmTarget): ArmTarget {
  const def = (ARM_POSES[side] as Record<string, { lean: number; x: number; y: number }>)[pose];
  // `down` has no pose of its own: keep the last lean so the paw sinks back
  // the way it came up.
  if (!def) return { ...previous, raise: 0 };
  return { raise: 1, lean: def.lean, padX: def.x, padY: def.y };
}

/**
 * @param gaze a point in the rig's SVG space, or null for nothing to look at
 * @param previousArms the arm targets from the last frame — lowered arms keep their lean
 */
export function rigTargets(
  expression: DogExpression,
  gaze: Point | null,
  tuning: { pupilRange: number; headTiltMax: number },
  previousArms: RigTargets['arms'],
): RigTargets {
  const target = expression.still ? null : gaze;
  const dx = target ? target.x - HEAD_CENTER.x : 0;
  const dy = target ? target.y - HEAD_CENTER.y : 0;
  return {
    pupils: {
      l: pupilOffset(EYE_CENTERS.l, target, tuning.pupilRange),
      r: pupilOffset(EYE_CENTERS.r, target, tuning.pupilRange),
    },
    headRotate: (expression.tilt ?? 0) + headTiltFor(target, tuning.headTiltMax),
    headX: target ? 2.5 * Math.tanh(dx / 300) : 0,
    headY: (expression.dip ?? 0) + (target ? 2 * Math.tanh(dy / 300) : 0),
    earSpread: EAR_SPREAD[expression.ears],
    eyeScale: expression.eyeScale ?? 1,
    arms: {
      l: armTarget('l', expression.arms[0], previousArms.l),
      r: armTarget('r', expression.arms[1], previousArms.r),
    },
  };
}
