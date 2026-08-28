import { describe, it, expect } from 'vitest';
import { agreementStepBlocker, isAgreementSettled } from './agreementSetup';

describe('isAgreementSettled', () => {
  it('is settled once the owner has explicitly opted out', () => {
    expect(isAgreementSettled({ agreementRequired: false, signatureConfigured: false })).toBe(true);
    expect(isAgreementSettled({ agreementRequired: false, signatureConfigured: true })).toBe(true);
  });

  it('is not settled on the untouched default — required, but never signed', () => {
    expect(isAgreementSettled({ agreementRequired: true, signatureConfigured: false })).toBe(false);
  });

  it('is settled once required and a signature actually exists', () => {
    expect(isAgreementSettled({ agreementRequired: true, signatureConfigured: true })).toBe(true);
  });
});

describe('agreementStepBlocker', () => {
  it('asks for a choice first', () => {
    expect(agreementStepBlocker(null, false)).toBe('Choose whether this hostel uses a tenant agreement');
  });

  it('lets "No" through with no signature', () => {
    expect(agreementStepBlocker('no', false)).toBeNull();
  });

  it('holds "Yes" until a signature is drawn', () => {
    expect(agreementStepBlocker('yes', false)).toBe('Draw your signature to continue');
    expect(agreementStepBlocker('yes', true)).toBeNull();
  });
});
