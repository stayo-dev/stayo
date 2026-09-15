import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { canEditInvitation, isUnacceptedTenancy } from '@/src/services/tenants/invitation-edit-window';

describe('isUnacceptedTenancy — the ADR-165 shape', () => {
  it('admits a tenancy created since ADR-165: live, not yet accepted', () => {
    // The exact row behind the owner's bug report: ACTIVE from birth, the
    // person has only opened the link. This is what the old
    // `status === 'INVITED'` guard refused.
    expect(isUnacceptedTenancy({ status: 'ACTIVE', acceptanceStatus: 'PENDING' })).toBe(true);
  });

  it('admits a pre-ADR-165 row sitting at INVITED', () => {
    expect(isUnacceptedTenancy({ status: 'INVITED', acceptanceStatus: 'NOT_REQUIRED' })).toBe(true);
  });

  it('refuses a tenancy the person has accepted', () => {
    expect(isUnacceptedTenancy({ status: 'ACTIVE', acceptanceStatus: 'ACCEPTED' })).toBe(false);
  });

  it('refuses a cancelled tenancy even though acceptance is still PENDING', () => {
    // closeUnacceptedTenancy deliberately leaves acceptance_status at PENDING
    // and marks the terminal state on `status`. Keying on acceptance alone
    // would make a cancelled invitation look editable.
    expect(isUnacceptedTenancy({ status: 'CANCELLED', acceptanceStatus: 'PENDING' })).toBe(false);
    expect(isUnacceptedTenancy({ status: 'EXPIRED', acceptanceStatus: 'PENDING' })).toBe(false);
  });

  it('refuses an ACTIVE tenancy that never required acceptance', () => {
    expect(isUnacceptedTenancy({ status: 'ACTIVE', acceptanceStatus: 'NOT_REQUIRED' })).toBe(false);
  });

  it('fails closed on absent signals', () => {
    expect(isUnacceptedTenancy({ status: null, acceptanceStatus: null })).toBe(false);
    expect(isUnacceptedTenancy({ status: undefined, acceptanceStatus: undefined })).toBe(false);
  });

  it('reads values case- and whitespace-insensitively', () => {
    expect(isUnacceptedTenancy({ status: ' active ', acceptanceStatus: 'pending' })).toBe(true);
  });
});

describe('canEditInvitation — refusals name what actually happened', () => {
  it('allows the edit while the offer is still open', () => {
    expect(canEditInvitation({ status: 'ACTIVE', acceptanceStatus: 'PENDING' })).toEqual({ allowed: true });
  });

  it('points an accepted tenancy at the change-request flow', () => {
    const verdict = canEditInvitation({ status: 'ACTIVE', acceptanceStatus: 'ACCEPTED' });
    expect(verdict.allowed).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringContaining('already accepted'));
  });

  it('tells the owner a cancelled invitation needs a new one', () => {
    const verdict = canEditInvitation({ status: 'CANCELLED', acceptanceStatus: 'PENDING' });
    expect(verdict.allowed).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringContaining('cancelled'));
  });

  it('never says "before tenant activation" — the message that was wrong', () => {
    // The owner was shown "Invitation can be edited only before tenant
    // activation" for a tenant who had not activated. That phrasing is gone.
    for (const tenancy of [
      { status: 'ACTIVE', acceptanceStatus: 'ACCEPTED' },
      { status: 'CANCELLED', acceptanceStatus: 'PENDING' },
      { status: 'INACTIVE', acceptanceStatus: 'NOT_REQUIRED' },
    ]) {
      const verdict = canEditInvitation(tenancy);
      expect(verdict.allowed).toBe(false);
      expect((verdict as { reason: string }).reason).not.toMatch(/before tenant activation/i);
    }
  });
});

/**
 * The two guards this module exists to replace. Read as source text, because
 * the failure mode is a *stale copy* reappearing — both were written against
 * `status === 'INVITED'` and silently stopped matching reality at ADR-165.
 */
describe('no stale INVITED-only guard remains on the edit path', () => {
  /**
   * Source with comments stripped. The guards below are described in prose
   * right where they were fixed — "this used to be `tenant.status !== …`" —
   * so a raw text search would match the explanation of the bug and report
   * the bug itself. Only executable code counts.
   */
  const read = (rel: string) =>
    fs
      .readFileSync(path.join(__dirname, '..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('updateInvitation gates on the shared predicate, not tenants.status', () => {
    const src = read('src/services/tenants/invitation-service.ts');
    expect(src).toContain('canEditInvitation');
    expect(src).not.toContain('Invitation can be edited only before tenant activation');
    expect(src).not.toMatch(/tenant\.status\s*!==\s*"INVITED"/);
  });

  it('updateInvitation no longer refuses outright once a payment exists', () => {
    // ADR-165 made an unaccepted tenancy live, so it accrues obligations and
    // payments before acceptance. The blanket refusal blocked the normal case.
    const src = read('src/services/tenants/invitation-service.ts');
    expect(src).not.toContain('Invitation cannot be edited after payment activity exists');
  });

  it('initializeOnboardingFinancials admits a live unaccepted tenancy', () => {
    // If this regresses, resendInvitation deletes the tenant's unpaid
    // obligations and then regenerates nothing — dues silently vanish.
    const src = read('src/services/payments/onboarding-financials-service.ts');
    expect(src).toContain('isUnacceptedTenancy');
    expect(src).not.toMatch(/tenant\.status\s*!==\s*"INVITED"/);
  });

  it('the financials guard still selects acceptance_status, or the predicate is blind', () => {
    const src = read('src/services/payments/onboarding-financials-service.ts');
    expect(src).toMatch(/acceptance_status:\s*true/);
  });
});
