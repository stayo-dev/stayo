import { describe, expect, it } from 'vitest';
import { ARM_POSES, DOG_EXPRESSIONS, EYE_CENTERS, PAW_PAD_RADIUS, type DogExpressionName } from './dogExpressions';

/**
 * The six poses in `Stayo-Brand-Assetes/MascotStayoDog/*.svg`, read off the
 * designer's files by hand: which shape each named group uses.
 */
const SOURCE_POSES: Record<string, Partial<(typeof DOG_EXPRESSIONS)[DogExpressionName]>> = {
  // stayo-mascot-neutral.svg: dot eyes, smile, hanging ears, low tail, paws down.
  neutral: { eyes: 'open', brows: 'none', mouth: 'smile', ears: 'rest', tail: 'down', arms: ['down', 'down'] },
  // stayo-mascot-happy.svg: arc eyes, open pant with tongue, perked ears, mid tail.
  happy: { eyes: 'happy', brows: 'none', mouth: 'pant', ears: 'perk', tail: 'mid', arms: ['down', 'down'] },
  // stayo-mascot-waving.svg: arc eyes, smile, mid tail, one paw raised.
  waving: { eyes: 'happy', mouth: 'smile', tail: 'mid', arms: ['down', 'wave'] },
  // stayo-mascot-thinking.svg: head rotated -8°, one raised brow, small mouth, thought bubble.
  thinking: { eyes: 'open', brows: 'curious', mouth: 'small', tail: 'down', tilt: -8, extra: 'bubble' },
  // stayo-mascot-celebrating.svg: arc eyes, both brows, big open mouth, high tail, both paws up, sparkles.
  celebrating: { eyes: 'happy', brows: 'raised', mouth: 'big', tail: 'high', arms: ['cheer', 'cheer'], extra: 'sparkles' },
  // stayo-mascot-sleepy.svg: head rotated 4°, closed eyes, small mouth, zzz.
  sleepy: { eyes: 'closed', brows: 'none', mouth: 'small', tail: 'down', tilt: 4, extra: 'zzz' },
};

describe('DOG_EXPRESSIONS reproduces the brand art', () => {
  for (const [name, pose] of Object.entries(SOURCE_POSES)) {
    it(`${name} matches stayo-mascot-${name}.svg`, () => {
      expect(DOG_EXPRESSIONS[name as DogExpressionName]).toMatchObject(pose);
    });
  }
});

describe('the derived v1 poses do the job they exist for', () => {
  const pad = (side: 'l' | 'r', pose: string) => ARM_POSES[side][pose as keyof (typeof ARM_POSES)['l']]!;
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it('covering raises both paws', () => {
    expect(DOG_EXPRESSIONS.covering.arms).toEqual(['cover', 'cover']);
  });

  it('a covering paw pad hides the whole eye under it', () => {
    // Eye radius is 8, so the pad must reach 8 units past the eye centre in every direction.
    for (const side of ['l', 'r'] as const) {
      const p = pad(side, 'cover');
      expect(distance({ x: p.x, y: p.y }, EYE_CENTERS[side]) + 8).toBeLessThanOrEqual(PAW_PAD_RADIUS.x);
    }
  });

  it('peeking keeps one eye covered and uncovers the other', () => {
    const [left, right] = DOG_EXPRESSIONS.peeking.arms;
    expect(left).toBe('cover');
    const peek = pad('r', right);
    // The lowered pad must clear the eye entirely: pad top below eye bottom.
    expect(peek.y - PAW_PAD_RADIUS.y).toBeGreaterThan(EYE_CENTERS.r.y + 8);
  });

  it('peeking opens exactly the uncovered eye', () => {
    expect(DOG_EXPRESSIONS.peeking.eyes).toBe('peek');
  });

  it('concerned droops the ears rather than perking them', () => {
    expect(DOG_EXPRESSIONS.concerned.ears).toBe('droop');
  });

  it('concerned never wags: sympathy is not joy', () => {
    expect(DOG_EXPRESSIONS.concerned.wag).toBe(0);
  });
});

describe('no expression leaves a part undefined', () => {
  it.each(Object.keys(DOG_EXPRESSIONS))('%s defines eyes, brows, mouth, ears, tail and both arms', (name) => {
    const e = DOG_EXPRESSIONS[name as DogExpressionName];
    for (const part of ['eyes', 'brows', 'mouth', 'ears', 'tail'] as const) expect(e[part]).toBeTruthy();
    expect(e.arms).toHaveLength(2);
  });
});
