import { describe, expect, it } from 'vitest';
import { crossSurfaceHandoff } from './crossSurfaceLogin';

describe('crossSurfaceHandoff — signing in on Discovery', () => {
  it('tells an owner why they are being taken to the owner dashboard', () => {
    // Previously this was a silent window.location.assign, which reads as a
    // bug or a security fright right after typing a password.
    const handoff = crossSurfaceHandoff({ role: 'OWNER' }, 'discovery');
    expect(handoff?.path).toBe('/owner/home');
    expect(handoff?.message).toMatch(/manages a hostel/i);
  });

  it('names the admin console for an admin', () => {
    expect(crossSurfaceHandoff({ role: 'ADMIN' }, 'discovery')?.path).toBe('/admin');
  });

  it('says nothing to a resident, who is already where they belong', () => {
    expect(crossSurfaceHandoff({ role: 'TENANT' }, 'discovery')).toBeNull();
    expect(crossSurfaceHandoff({ role: 'tenant', tenantId: 't1' }, 'discovery')).toBeNull();
  });
});

describe('crossSurfaceHandoff — signing in on the owner site', () => {
  it('sends a resident with a tenancy to their dashboard, and says why', () => {
    const handoff = crossSurfaceHandoff({ role: 'TENANT', tenantId: 't1' }, 'owner');
    expect(handoff?.path).toBe('/tenant/home');
    expect(handoff?.message).toMatch(/resident account/i);
  });

  it('sends a resident with no active tenancy to the Profile hub (v1 — no marketplace)', () => {
    expect(crossSurfaceHandoff({ role: 'TENANT' }, 'owner')?.path).toBe('/profile');
  });

  it('says nothing to an owner or admin, who belong here', () => {
    expect(crossSurfaceHandoff({ role: 'OWNER' }, 'owner')).toBeNull();
    expect(crossSurfaceHandoff({ role: 'ADMIN' }, 'owner')).toBeNull();
  });
});

describe('unknown roles', () => {
  it('never invents a destination', () => {
    expect(crossSurfaceHandoff({ role: '' }, 'discovery')).toBeNull();
    expect(crossSurfaceHandoff({ role: null }, 'owner')).toBeNull();
    expect(crossSurfaceHandoff({}, 'discovery')).toBeNull();
  });
});
