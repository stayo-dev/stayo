import { describe, it, expect } from 'vitest';
import { masterDetailBranch } from './masterDetailBranch';

describe('masterDetailBranch', () => {
  it('composes both columns on desktop, regardless of selection', () => {
    expect(masterDetailBranch({ isDesktop: true, hasSelection: false })).toBe('both');
    expect(masterDetailBranch({ isDesktop: true, hasSelection: true })).toBe('both');
  });

  it('shows the list full-screen on mobile with nothing selected', () => {
    expect(masterDetailBranch({ isDesktop: false, hasSelection: false })).toBe('list');
  });

  it('shows the detail takeover full-screen on mobile with a selection', () => {
    expect(masterDetailBranch({ isDesktop: false, hasSelection: true })).toBe('detail');
  });
});
