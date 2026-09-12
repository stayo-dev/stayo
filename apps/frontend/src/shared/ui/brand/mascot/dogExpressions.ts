/**
 * The Stayo dog's expressions, as settings of ONE rig.
 *
 * The brand art (`Stayo-Brand-Assetes/MascotStayoDog/`) is six poses drawn on
 * the same skeleton — only ears, brows, eyes, mouth, tail and paws change.
 * So an expression here is a choice of variant per part, plus a head tilt and
 * an optional extra. `dogParts.tsx` draws every variant; the frame loop shows
 * the ones chosen here. Six entries reproduce the designer's files exactly
 * (see the test); the rest are derived from the same parts.
 *
 * DERIVED v1 ART — for the designer to refine: `covering`, `peeking`,
 * `concerned`, `curious` and `attentive` / `reading` are built in code from
 * existing shapes (the celebrating paws, the sleepy eyes, the thinking brow).
 *
 * PURE — no DOM, runs under vitest's node environment.
 */
export type DogEyes = 'open' | 'happy' | 'closed' | 'peek';
export type DogBrows = 'none' | 'raised' | 'curious' | 'concerned';
export type DogMouth = 'smile' | 'pant' | 'big' | 'small' | 'wobble';
export type DogEars = 'rest' | 'perk' | 'droop';
export type DogTail = 'down' | 'mid' | 'high';
export type DogArmPose = 'down' | 'cover' | 'peek' | 'cheer' | 'wave';
export type DogExtra = 'bubble' | 'sparkles' | 'zzz';

export interface DogExpression {
  eyes: DogEyes;
  brows: DogBrows;
  mouth: DogMouth;
  ears: DogEars;
  tail: DogTail;
  /** Tail wag strength: 0 is still, 1 a happy wag. */
  wag: number;
  /** Left arm, right arm (the dog's left is the viewer's left). */
  arms: readonly [DogArmPose, DogArmPose];
  /** Head rotation in degrees, before any gaze tilt. */
  tilt?: number;
  /** Head dip in SVG units — looking down at the form. */
  dip?: number;
  /** Eye scale: above 1 reads as wide-eyed. */
  eyeScale?: number;
  /** Ignore the gaze target entirely (eyes closed or covered). */
  still?: boolean;
  extra?: DogExtra;
}

export const DOG_EXPRESSIONS = {
  neutral: { eyes: 'open', brows: 'none', mouth: 'smile', ears: 'rest', tail: 'down', wag: 0, arms: ['down', 'down'] },
  attentive: { eyes: 'open', brows: 'none', mouth: 'smile', ears: 'perk', tail: 'mid', wag: 0.35, arms: ['down', 'down'] },
  reading: { eyes: 'open', brows: 'none', mouth: 'smile', ears: 'rest', tail: 'mid', wag: 0, arms: ['down', 'down'], dip: 5 },
  covering: { eyes: 'closed', brows: 'none', mouth: 'smile', ears: 'rest', tail: 'mid', wag: 0, arms: ['cover', 'cover'], still: true },
  peeking: { eyes: 'peek', brows: 'none', mouth: 'small', ears: 'perk', tail: 'mid', wag: 0.3, arms: ['cover', 'peek'], eyeScale: 1.15, tilt: 4 },
  curious: { eyes: 'open', brows: 'curious', mouth: 'small', ears: 'perk', tail: 'mid', wag: 0, arms: ['down', 'down'], eyeScale: 1.15, tilt: -6 },
  thinking: { eyes: 'open', brows: 'curious', mouth: 'small', ears: 'rest', tail: 'down', wag: 0, arms: ['down', 'down'], tilt: -8, extra: 'bubble' },
  concerned: { eyes: 'open', brows: 'concerned', mouth: 'wobble', ears: 'droop', tail: 'down', wag: 0, arms: ['down', 'down'], dip: 3 },
  happy: { eyes: 'happy', brows: 'none', mouth: 'pant', ears: 'perk', tail: 'mid', wag: 1, arms: ['down', 'down'] },
  celebrating: { eyes: 'happy', brows: 'raised', mouth: 'big', ears: 'perk', tail: 'high', wag: 1.4, arms: ['cheer', 'cheer'], extra: 'sparkles' },
  waving: { eyes: 'happy', brows: 'none', mouth: 'smile', ears: 'perk', tail: 'mid', wag: 0.8, arms: ['down', 'wave'] },
  sleepy: { eyes: 'closed', brows: 'none', mouth: 'small', ears: 'rest', tail: 'down', wag: 0, arms: ['down', 'down'], tilt: 4, extra: 'zzz', still: true },
} as const satisfies Record<string, DogExpression>;

export type DogExpressionName = keyof typeof DOG_EXPRESSIONS;

/** Eye centres in the art (`eye-left` / `eye-right` circles). */
export const EYE_CENTERS = { l: { x: 130, y: 112 }, r: { x: 170, y: 112 } } as const;

/** The paw pad ellipse's radii. */
export const PAW_PAD_RADIUS = { x: 15, y: 12 } as const;

/**
 * Where each raised paw's pad lands, and the forearm's lean in degrees.
 * `down` has no entry: a lowered arm keeps its last lean and sinks behind the
 * rim along it (see `armTransform`).
 */
export const ARM_POSES = {
  l: {
    cover: { lean: 12, x: 130, y: 112 },
    peek: { lean: 12, x: 124, y: 148 },
    cheer: { lean: -22, x: 72, y: 108 },
  },
  r: {
    cover: { lean: -12, x: 170, y: 112 },
    peek: { lean: -12, x: 178, y: 148 },
    cheer: { lean: 22, x: 228, y: 108 },
    wave: { lean: 22, x: 228, y: 104 },
  },
} as const satisfies Record<'l' | 'r', Partial<Record<DogArmPose, { lean: number; x: number; y: number }>>>;
