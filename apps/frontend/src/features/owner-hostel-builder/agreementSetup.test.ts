import { describe, it, expect } from 'vitest';
import {
  agreementStepBlocker,
  guardianChoiceFromPolicy,
  guardianPolicyValue,
  isAgreementSettled,
  onboardingRulesStepBlocker,
} from './agreementSetup';

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

describe('onboardingRulesStepBlocker', () => {
  it('asks the agreement question first, since it is the one above it on screen', () => {
    expect(onboardingRulesStepBlocker(null, false, 'mandatory')).toBe(
      'Choose whether this hostel uses a tenant agreement',
    );
  });

  it('still demands the signature before moving on to the guardian question', () => {
    expect(onboardingRulesStepBlocker('yes', false, 'mandatory')).toBe('Draw your signature to continue');
  });

  it('blocks on an unanswered guardian question rather than assuming one', () => {
    // Left unset this would silently mean "chase every tenant's parent for
    // ever", which is a decision, not a default.
    expect(onboardingRulesStepBlocker('no', false, null)).toBe('Choose how guardian numbers are verified');
  });

  it('clears once both questions are answered', () => {
    expect(onboardingRulesStepBlocker('no', false, 'optional')).toBeNull();
    expect(onboardingRulesStepBlocker('yes', true, 'mandatory')).toBeNull();
  });
});

describe('guardianChoiceFromPolicy', () => {
  it('reports an absent setting as unanswered, so a new build is asked', () => {
    expect(guardianChoiceFromPolicy(undefined)).toBeNull();
    expect(guardianChoiceFromPolicy(null)).toBeNull();
  });

  it('reads a stored value back', () => {
    expect(guardianChoiceFromPolicy('OPTIONAL')).toBe('optional');
    expect(guardianChoiceFromPolicy('MANDATORY')).toBe('mandatory');
  });

  it('treats anything unrecognised as the strict setting, never as optional', () => {
    expect(guardianChoiceFromPolicy('nonsense')).toBe('mandatory');
  });
});

describe('guardianPolicyValue', () => {
  it('maps the screen vocabulary to the API vocabulary', () => {
    expect(guardianPolicyValue('optional')).toBe('OPTIONAL');
    expect(guardianPolicyValue('mandatory')).toBe('MANDATORY');
  });
});
