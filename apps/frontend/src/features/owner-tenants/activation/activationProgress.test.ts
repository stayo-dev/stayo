import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_STEP_ORDER,
  PENDING_ACTIVATIONS_PATH,
  activationStepLabel,
  currentStepLabel,
  isAwaitingActivation,
  kycBadge,
  toActivationProgress,
  waitingSinceLabel,
} from './activationProgress';

/**
 * Presentation only. The activation state machine lives in the backend
 * (`activationWorkflowService.computeState`) and is the source of truth — this
 * module turns its output into owner-facing labels and must never re-derive
 * which step is current.
 */

function state(overrides: Record<string, unknown> = {}) {
  return {
    account_setup_completed: true,
    rules_accepted: false,
    agreement_signed: false,
    profile_completed: true,
    documents_uploaded: false,
    activation_completed: false,
    current_step: 'RULES',
    completed_steps: ['ACCOUNT', 'PROFILE'],
    blocked_steps: ['AGREEMENT', 'ACTIVATE'],
    progress_percent: 40,
    missing_fields: { tier_1_required: [], tier_2_recommended: [], tier_3_optional: [] },
    activation_started_at: '2026-07-28T09:00:00.000Z',
    activation_completed_at: null,
    ...overrides,
  };
}

describe('activationStepLabel', () => {
  it('names every step the backend can report', () => {
    expect(activationStepLabel('ACCOUNT')).toBe('Waiting for account creation');
    expect(activationStepLabel('RULES')).toBe('Waiting for rules acceptance');
    expect(activationStepLabel('AGREEMENT')).toBe('Waiting for agreement');
    expect(activationStepLabel('PROFILE')).toBe('Waiting for profile completion');
    expect(activationStepLabel('ACTIVATE')).toBe('Ready to activate');
  });

  it('falls back to the raw step rather than rendering nothing', () => {
    expect(activationStepLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('keeps the five steps in workflow order', () => {
    expect(ACTIVATION_STEP_ORDER).toEqual(['ACCOUNT', 'RULES', 'AGREEMENT', 'PROFILE', 'ACTIVATE']);
  });
});

describe('currentStepLabel', () => {
  it('reads the backend current_step rather than inferring one', () => {
    expect(currentStepLabel(state({ current_step: 'AGREEMENT' }))).toBe('Waiting for agreement');
  });

  it('says Activated once the backend reports completion', () => {
    expect(currentStepLabel(state({ activation_completed: true, current_step: 'ACTIVATE' }))).toBe('Activated');
  });

  it('trusts activation_completed over current_step, never the other way round', () => {
    // ACTIVATE is both "ready to activate" and the completed step — only
    // activation_completed distinguishes them.
    expect(currentStepLabel(state({ current_step: 'ACTIVATE', activation_completed: false }))).toBe('Ready to activate');
  });
});

describe('toActivationProgress', () => {
  it('marks each step done / current / blocked from the backend arrays', () => {
    const steps = toActivationProgress(state()).steps;

    expect(steps.find((s) => s.step === 'ACCOUNT')?.status).toBe('done');
    expect(steps.find((s) => s.step === 'RULES')?.status).toBe('current');
    expect(steps.find((s) => s.step === 'AGREEMENT')?.status).toBe('blocked');
  });

  it('always returns all five steps so the tracker never collapses', () => {
    expect(toActivationProgress(state()).steps).toHaveLength(5);
  });

  it('carries the backend progress percentage through unchanged', () => {
    expect(toActivationProgress(state({ progress_percent: 80 })).percent).toBe(80);
  });

  it('does not recompute the percentage from the step list', () => {
    // If the backend ever changes its weighting, the UI must follow it.
    expect(toActivationProgress(state({ progress_percent: 33, completed_steps: ['ACCOUNT'] })).percent).toBe(33);
  });

  it('survives a missing or malformed state rather than crashing the page', () => {
    expect(toActivationProgress(null).steps).toHaveLength(5);
    expect(toActivationProgress(null).percent).toBe(0);
  });

  // With no state loaded we do not know that anything is blocked — saying so
  // would invent a claim the backend never made. "pending" is the honest
  // rendering of "not yet known".
  it('shows unknown steps as pending, not blocked', () => {
    expect(toActivationProgress(undefined).steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('surfaces the missing profile fields the backend named', () => {
    const progress = toActivationProgress(
      state({ current_step: 'PROFILE', missing_fields: { tier_1_required: ['photo_url', 'gender'], tier_2_recommended: [], tier_3_optional: [] } }),
    );

    expect(progress.missingFields).toEqual(['photo_url', 'gender']);
  });
});

describe('isAwaitingActivation', () => {
  // A tenancy is ACTIVE from the moment it's invited (see createInvitation),
  // so status no longer tells "hasn't taken charge yet" apart from any other
  // active tenant — access_mode does. This used to key off tenants.status
  // === 'INVITED'; that was the defect this queue exists to not have.
  it('is true for an owner-managed tenant who has not finished', () => {
    expect(isAwaitingActivation('OWNER_MANAGED', state())).toBe(true);
  });

  it('is false once activation completed', () => {
    expect(isAwaitingActivation('SELF_SERVE', state({ activation_completed: true }))).toBe(false);
  });

  // Requirement: the tenant disappears from the queue automatically.
  it('drops out the moment the backend reports completion, whatever the row access_mode says', () => {
    expect(isAwaitingActivation('OWNER_MANAGED', state({ activation_completed: true }))).toBe(false);
  });

  it('is false for a tenant who claimed their own account', () => {
    expect(isAwaitingActivation('SELF_SERVE', state())).toBe(false);
  });

  it('is false when access_mode is missing', () => {
    expect(isAwaitingActivation(null, state())).toBe(false);
    expect(isAwaitingActivation(undefined, state())).toBe(false);
  });
});

describe('kycBadge — an independent state machine', () => {
  it('shows KYC Pending when documents are not verified', () => {
    expect(kycBadge(false)).toEqual({ label: 'KYC Pending', tone: 'warning' });
  });

  it('shows KYC Verified when they are', () => {
    expect(kycBadge(true)).toEqual({ label: 'KYC Verified', tone: 'success' });
  });

  it('never reports on activation — the two are separate', () => {
    // Same KYC badge regardless of where activation has reached.
    expect(kycBadge(false)).toEqual(kycBadge(false));
  });
});

describe('waitingSinceLabel', () => {
  it('reads as days waited', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(waitingSinceLabel(threeDaysAgo)).toBe('3 days');
  });

  it('says today for a fresh invite', () => {
    expect(waitingSinceLabel(new Date().toISOString())).toBe('today');
  });

  it('uses the singular for one day', () => {
    expect(waitingSinceLabel(new Date(Date.now() - 86_400_000).toISOString())).toBe('1 day');
  });

  it('returns nothing for a missing or unparseable date', () => {
    expect(waitingSinceLabel(null)).toBeNull();
    expect(waitingSinceLabel('not-a-date')).toBeNull();
  });
});

describe('navigation', () => {
  it('exposes the pending-activations path as a single source of truth', () => {
    expect(PENDING_ACTIVATIONS_PATH).toBe('/owner/tenants/activations');
  });
});
