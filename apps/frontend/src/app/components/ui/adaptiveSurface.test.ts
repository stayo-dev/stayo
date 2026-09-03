import { describe, it, expect } from 'vitest';
import { surfaceForVariant, type SurfaceVariant } from './adaptiveSurface';

const ALL: SurfaceVariant[] = ['wizard', 'form', 'menu', 'picker', 'explain', 'confirm', 'preview'];

describe('surfaceForVariant', () => {
  it('is a bottom sheet for every variant on mobile', () => {
    for (const v of ALL) {
      expect(surfaceForVariant(v, true)).toBe('bottom-sheet');
    }
  });

  it('maps each variant to its desktop primitive', () => {
    expect(surfaceForVariant('wizard', false)).toBe('dialog');
    expect(surfaceForVariant('confirm', false)).toBe('dialog');
    expect(surfaceForVariant('preview', false)).toBe('dialog');
    expect(surfaceForVariant('form', false)).toBe('drawer');
    expect(surfaceForVariant('menu', false)).toBe('dropdown');
    expect(surfaceForVariant('picker', false)).toBe('popover');
    expect(surfaceForVariant('explain', false)).toBe('popover');
  });

  it('never returns a bottom sheet on desktop', () => {
    for (const v of ALL) {
      expect(surfaceForVariant(v, false)).not.toBe('bottom-sheet');
    }
  });
});
