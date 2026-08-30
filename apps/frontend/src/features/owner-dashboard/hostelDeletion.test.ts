import { describe, it, expect } from 'vitest';
import { confirmHostelDeletion } from './hostelDeletion';

describe('confirmHostelDeletion', () => {
  const name = 'Sunrise Residency';

  it('accepts the name typed exactly', () => {
    expect(confirmHostelDeletion(name, name)).toBe(true);
  });

  it('forgives case, surrounding whitespace and doubled spaces', () => {
    expect(confirmHostelDeletion('  sunrise residency ', name)).toBe(true);
    expect(confirmHostelDeletion('SUNRISE RESIDENCY', name)).toBe(true);
    expect(confirmHostelDeletion('Sunrise   Residency', name)).toBe(true);
  });

  it('rejects a different hostel or a partial name', () => {
    expect(confirmHostelDeletion('Lakeview Residency', name)).toBe(false);
    expect(confirmHostelDeletion('Sunrise', name)).toBe(false);
    expect(confirmHostelDeletion('', name)).toBe(false);
  });

  // Short junk names are exactly what this action exists to clear out, so they
  // still have to be typed rather than waved through.
  it('still requires typing a very short name', () => {
    expect(confirmHostelDeletion('', 'test')).toBe(false);
    expect(confirmHostelDeletion('test', 'test')).toBe(true);
  });

  it('never matches when the hostel has no name on file', () => {
    expect(confirmHostelDeletion('', '')).toBe(false);
    expect(confirmHostelDeletion('   ', '  ')).toBe(false);
  });
});
