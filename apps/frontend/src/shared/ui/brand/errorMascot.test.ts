import { describe, it, expect } from 'vitest';
import { errorMascotExpression, showsErrorMascot } from './errorMascot';
import { DOG_EXPRESSIONS } from './mascot';

describe('errorMascotExpression', () => {
  it('tilts its head at a missing page', () => {
    expect(errorMascotExpression('notFound')).toBe('curious');
  });

  it('is disappointed, not alarmed, at everything that broke', () => {
    for (const tone of ['network', 'server', 'generic', 'auth'] as const) {
      expect(errorMascotExpression(tone)).toBe('concerned');
    }
  });

  it('never covers its eyes — that gesture belongs to password privacy', () => {
    for (const tone of ['network', 'auth', 'notFound', 'server', 'generic'] as const) {
      expect(errorMascotExpression(tone)).not.toBe('covering');
    }
  });

  it('only ever names a real expression on the rig', () => {
    for (const tone of ['network', 'auth', 'notFound', 'server', 'generic'] as const) {
      expect(DOG_EXPRESSIONS).toHaveProperty(errorMascotExpression(tone));
    }
  });
});

describe('showsErrorMascot', () => {
  it('appears on a whole-surface failure', () => {
    expect(showsErrorMascot('screen')).toBe(true);
  });

  it('stays away from a section that failed beside working content', () => {
    expect(showsErrorMascot('inset')).toBe(false);
  });

  it('lets a caller force it either way', () => {
    expect(showsErrorMascot('inset', true)).toBe(true);
    expect(showsErrorMascot('screen', false)).toBe(false);
  });
});
