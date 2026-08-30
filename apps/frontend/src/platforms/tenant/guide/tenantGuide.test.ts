import { describe, it, expect } from 'vitest';
import { guideKey, shouldShowBeat, welcomeStops } from './tenantGuide';

describe('guideKey', () => {
  it('scopes the key to the tenant, so two tenants on one phone do not share it', () => {
    expect(guideKey('room', 'tenant-a')).not.toBe(guideKey('room', 'tenant-b'));
  });

  it('scopes the key to the beat, so dismissing Room does not dismiss Food', () => {
    expect(guideKey('room', 'tenant-a')).not.toBe(guideKey('food', 'tenant-a'));
  });

  it('carries the tenant id in the key', () => {
    expect(guideKey('welcome', 'tenant-a')).toContain('tenant-a');
  });

  it('refuses a key when there is no tenant, rather than falling back to a shared one', () => {
    expect(guideKey('welcome', null)).toBeNull();
    expect(guideKey('welcome', undefined)).toBeNull();
    expect(guideKey('welcome', '   ')).toBeNull();
  });
});

describe('welcomeStops', () => {
  it('opens on the rent card when money is owed', () => {
    expect(welcomeStops({ hasAmountDue: true })).toEqual(['rent', 'header', 'nav']);
  });

  it('drops the rent stop entirely when nothing is owed, because Home does not render that card', () => {
    expect(welcomeStops({ hasAmountDue: false })).toEqual(['header', 'nav']);
  });

  it('always ends on the nav map, the only thing that pulls a tenant to other tabs', () => {
    const owed = welcomeStops({ hasAmountDue: true });
    const clear = welcomeStops({ hasAmountDue: false });
    expect(owed[owed.length - 1]).toBe('nav');
    expect(clear[clear.length - 1]).toBe('nav');
  });
});

describe('shouldShowBeat', () => {
  const live = { tenantId: 'tenant-a', seen: false, ready: true, readOnly: false };

  it('shows an unseen beat to a live tenant on a loaded screen', () => {
    expect(shouldShowBeat(live)).toBe(true);
  });

  it('waits for the screen to load, so it never anchors to a skeleton', () => {
    expect(shouldShowBeat({ ...live, ready: false })).toBe(false);
  });

  it('never repeats a beat that has been seen', () => {
    expect(shouldShowBeat({ ...live, seen: true })).toBe(false);
  });

  it('teaches nothing to a tenant who has moved out and is read-only', () => {
    expect(shouldShowBeat({ ...live, readOnly: true })).toBe(false);
  });

  it('shows nothing when there is no tenant to scope the beat to', () => {
    expect(shouldShowBeat({ ...live, tenantId: null })).toBe(false);
  });
});
