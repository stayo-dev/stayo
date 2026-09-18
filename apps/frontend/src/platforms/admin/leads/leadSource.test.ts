import { describe, expect, it } from 'vitest';
import { leadSourceBadge, pipelineSourceParam, PIPELINE_SOURCES } from './leadSource';

describe('leadSourceBadge', () => {
  it('separates a lead the owner submitted from one nobody did', () => {
    expect(leadSourceBadge('WEBSITE').ownerSubmitted).toBe(true);
    expect(leadSourceBadge('STUDENT_REFERRAL').ownerSubmitted).toBe(false);
    expect(leadSourceBadge('DISCOVER_DEMAND').ownerSubmitted).toBe(false);
    expect(leadSourceBadge('DIRECT_ADMIN').ownerSubmitted).toBe(false);
  });

  it('names each source in words an admin can act on', () => {
    expect(leadSourceBadge('WEBSITE').label).toBe('Owner signup');
    expect(leadSourceBadge('STUDENT_REFERRAL').label).toBe('Student referral');
    expect(leadSourceBadge('DISCOVER_DEMAND').label).toBe('Tenant demand');
  });

  it('warns that a referred number is unverified', () => {
    expect(leadSourceBadge('STUDENT_REFERRAL').hint).toContain('unverified');
  });

  it('treats a missing or unrecognised source as unsolicited, never as a signup', () => {
    for (const value of [null, undefined, '', 'SOMETHING_NEW']) {
      const badge = leadSourceBadge(value);
      expect(badge.label).toBe('Unknown source');
      expect(badge.ownerSubmitted).toBe(false);
    }
  });
});

describe('pipelineSourceParam', () => {
  it('asks for owner signups and both unsolicited kinds', () => {
    expect(pipelineSourceParam()).toBe('WEBSITE,STUDENT_REFERRAL,DISCOVER_DEMAND');
  });

  it('leaves Admin -> Add Owner out, because the Owners page owns it', () => {
    expect(PIPELINE_SOURCES).not.toContain('DIRECT_ADMIN');
  });
});
