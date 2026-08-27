import { describe, it, expect } from 'vitest';
import {
  claimReducer,
  initialClaimState,
  emptyAcknowledgements,
  acknowledgementsComplete,
  canConfirm,
  canSendOtp,
  canVerifyOtp,
  selectedTenancy,
  REQUIRED_ACKNOWLEDGEMENTS,
  type ClaimState,
  type ClaimTenancy,
} from './claimSteps';

const tenancy = (overrides: Partial<ClaimTenancy> = {}): ClaimTenancy => ({
  tenant_id: 't-1',
  hostel_name: 'Sunrise PG',
  room_no: '204',
  joined_on: '2026-03-01',
  owner_name: 'Ravi Kumar',
  monthly_rent: 9000,
  ...overrides,
});

const allAcksTrue = () => {
  const acks = emptyAcknowledgements();
  for (const key of REQUIRED_ACKNOWLEDGEMENTS) acks[key] = true;
  return acks;
};

describe('initialClaimState', () => {
  it('starts on the phone step with nothing filled in', () => {
    const state = initialClaimState();
    expect(state.step).toBe('phone');
    expect(state.phone).toBe('');
    expect(state.tenancies).toEqual([]);
    expect(state.selectedTenantId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.result).toBeNull();
  });
});

describe('phone step', () => {
  it('PHONE_CHANGED updates the phone and clears a stale error', () => {
    const state = { ...initialClaimState(), error: 'previous failure' };
    const next = claimReducer(state, { type: 'PHONE_CHANGED', phone: '9876543210' });
    expect(next.phone).toBe('9876543210');
    expect(next.error).toBeNull();
  });

  it('SEND_OTP_REQUESTED marks submitting without changing step', () => {
    const next = claimReducer(initialClaimState(), { type: 'SEND_OTP_REQUESTED' });
    expect(next.submitting).toBe(true);
    expect(next.step).toBe('phone');
  });

  it('SEND_OTP_SUCCEEDED advances to otp and resets any typed code', () => {
    const state = { ...initialClaimState(), submitting: true, otp: 'stale' };
    const next = claimReducer(state, { type: 'SEND_OTP_SUCCEEDED' });
    expect(next.step).toBe('otp');
    expect(next.otp).toBe('');
    expect(next.submitting).toBe(false);
  });

  it('SEND_OTP_FAILED (WhatsApp down) stays on phone and surfaces a retryable error, never waves the tenant through', () => {
    const state = { ...initialClaimState(), submitting: true };
    const next = claimReducer(state, { type: 'SEND_OTP_FAILED', message: "Couldn't send the code" });
    expect(next.step).toBe('phone');
    expect(next.submitting).toBe(false);
    expect(next.error).toBe("Couldn't send the code");
  });
});

describe('canSendOtp', () => {
  it('accepts a full 10-digit Indian mobile number', () => {
    expect(canSendOtp('9876543210')).toBe(true);
    expect(canSendOtp('+919876543210')).toBe(true);
  });

  it('rejects anything short of a full number', () => {
    expect(canSendOtp('12345')).toBe(false);
    expect(canSendOtp('')).toBe(false);
  });
});

describe('otp step', () => {
  it('VERIFY_OTP_REQUESTED marks submitting, stays on otp', () => {
    const state = { ...initialClaimState(), step: 'otp' as const };
    const next = claimReducer(state, { type: 'VERIFY_OTP_REQUESTED' });
    expect(next.submitting).toBe(true);
    expect(next.step).toBe('otp');
  });

  it('VERIFY_OTP_FAILED (wrong code) stays on otp with the error, not stranded elsewhere', () => {
    const state = { ...initialClaimState(), step: 'otp' as const, submitting: true };
    const next = claimReducer(state, { type: 'VERIFY_OTP_FAILED', message: 'That code is not right' });
    expect(next.step).toBe('otp');
    expect(next.error).toBe('That code is not right');
    expect(next.submitting).toBe(false);
  });
});

describe('canVerifyOtp', () => {
  it('requires exactly 6 digits', () => {
    expect(canVerifyOtp('123456')).toBe(true);
    expect(canVerifyOtp('12345')).toBe(false);
    expect(canVerifyOtp('1234567')).toBe(false);
  });
});

describe('LOOKUP_SUCCEEDED', () => {
  it('an empty result is a normal outcome, not an error -- lands on the empty step', () => {
    const state = { ...initialClaimState(), step: 'otp' as const };
    const next = claimReducer(state, { type: 'LOOKUP_SUCCEEDED', tenancies: [] });
    expect(next.step).toBe('empty');
    expect(next.selectedTenantId).toBeNull();
    expect(next.error).toBeNull();
  });

  it('a single match skips the picker and auto-selects it', () => {
    const only = tenancy();
    const state = { ...initialClaimState(), step: 'otp' as const };
    const next = claimReducer(state, { type: 'LOOKUP_SUCCEEDED', tenancies: [only] });
    expect(next.step).toBe('confirm');
    expect(next.selectedTenantId).toBe('t-1');
    expect(next.tenancies).toEqual([only]);
  });

  it('multiple matches render the picker with nothing pre-selected', () => {
    const state = { ...initialClaimState(), step: 'otp' as const };
    const next = claimReducer(state, {
      type: 'LOOKUP_SUCCEEDED',
      tenancies: [tenancy({ tenant_id: 't-1' }), tenancy({ tenant_id: 't-2', hostel_name: 'Other PG' })],
    });
    expect(next.step).toBe('picker');
    expect(next.selectedTenantId).toBeNull();
    expect(next.tenancies).toHaveLength(2);
  });
});

describe('OTP_PROOF_REQUIRED recovery', () => {
  it('from LOOKUP_FAILED sends the tenant back to phone -- no re-verify of a dead code', () => {
    const state = { ...initialClaimState(), step: 'otp' as const, otp: '123456' };
    const next = claimReducer(state, {
      type: 'LOOKUP_FAILED',
      code: 'OTP_PROOF_REQUIRED',
      message: 'This phone number has not been freshly verified.',
    });
    expect(next.step).toBe('phone');
    expect(next.otp).toBe('');
    expect(next.error).toBe('This phone number has not been freshly verified.');
  });

  it('from CONFIRM_FAILED also sends the tenant back to phone -- a failed confirm may require re-verifying', () => {
    const state = {
      ...initialClaimState(),
      step: 'confirm' as const,
      tenancies: [tenancy()],
      selectedTenantId: 't-1',
    };
    const next = claimReducer(state, {
      type: 'CONFIRM_FAILED',
      code: 'OTP_PROOF_REQUIRED',
      message: 'This claim proof was already used.',
    });
    expect(next.step).toBe('phone');
    expect(next.otp).toBe('');
  });
});

describe('picker step', () => {
  it('SELECT_TENANCY advances to confirm with that tenancy chosen', () => {
    const state = {
      ...initialClaimState(),
      step: 'picker' as const,
      tenancies: [tenancy({ tenant_id: 't-1' }), tenancy({ tenant_id: 't-2' })],
    };
    const next = claimReducer(state, { type: 'SELECT_TENANCY', tenantId: 't-2' });
    expect(next.step).toBe('confirm');
    expect(next.selectedTenantId).toBe('t-2');
  });

  it('BACK_TO_PICKER from confirm returns to the picker when there was a real choice', () => {
    const state = {
      ...initialClaimState(),
      step: 'confirm' as const,
      tenancies: [tenancy({ tenant_id: 't-1' }), tenancy({ tenant_id: 't-2' })],
      selectedTenantId: 't-2',
    };
    const next = claimReducer(state, { type: 'BACK_TO_PICKER' });
    expect(next.step).toBe('picker');
    expect(next.selectedTenantId).toBeNull();
  });

  it('BACK_TO_PICKER is a no-op when there was only ever one candidate', () => {
    const state = {
      ...initialClaimState(),
      step: 'confirm' as const,
      tenancies: [tenancy()],
      selectedTenantId: 't-1',
    };
    const next = claimReducer(state, { type: 'BACK_TO_PICKER' });
    expect(next).toBe(state);
  });
});

describe('NOT_CLAIMABLE recovery', () => {
  it('drops the failed tenancy and re-picks when two remain candidates but one drops out', () => {
    const state = {
      ...initialClaimState(),
      step: 'confirm' as const,
      tenancies: [tenancy({ tenant_id: 't-1' }), tenancy({ tenant_id: 't-2' }), tenancy({ tenant_id: 't-3' })],
      selectedTenantId: 't-1',
    };
    const next = claimReducer(state, {
      type: 'CONFIRM_FAILED',
      code: 'NOT_CLAIMABLE',
      message: 'This tenancy can no longer be claimed with this phone number',
    });
    expect(next.tenancies.map((t) => t.tenant_id)).toEqual(['t-2', 't-3']);
    expect(next.step).toBe('picker');
    expect(next.selectedTenantId).toBeNull();
    expect(next.error).toBe('This tenancy can no longer be claimed with this phone number');
  });

  it('auto-advances back to confirm when exactly one candidate remains', () => {
    const state = {
      ...initialClaimState(),
      step: 'confirm' as const,
      tenancies: [tenancy({ tenant_id: 't-1' }), tenancy({ tenant_id: 't-2' })],
      selectedTenantId: 't-1',
    };
    const next = claimReducer(state, { type: 'CONFIRM_FAILED', code: 'NOT_CLAIMABLE', message: 'gone' });
    expect(next.step).toBe('confirm');
    expect(next.selectedTenantId).toBe('t-2');
  });

  it('lands on empty when the only candidate drops out', () => {
    const state = {
      ...initialClaimState(),
      step: 'confirm' as const,
      tenancies: [tenancy({ tenant_id: 't-1' })],
      selectedTenantId: 't-1',
    };
    const next = claimReducer(state, { type: 'CONFIRM_FAILED', code: 'NOT_CLAIMABLE', message: 'gone' });
    expect(next.step).toBe('empty');
    expect(next.tenancies).toEqual([]);
  });
});

describe('ROLE_MISMATCH and VALIDATION_ERROR', () => {
  it('ROLE_MISMATCH stays on the current step -- no in-flow retry fixes it', () => {
    const state = {
      ...initialClaimState(),
      step: 'confirm' as const,
      tenancies: [tenancy()],
      selectedTenantId: 't-1',
    };
    const next = claimReducer(state, {
      type: 'CONFIRM_FAILED',
      code: 'ROLE_MISMATCH',
      message: 'This phone number is already linked to a different kind of Stayo account',
    });
    expect(next.step).toBe('confirm');
    expect(next.tenancies).toEqual(state.tenancies);
    expect(next.selectedTenantId).toBe('t-1');
    expect(next.error).toContain('different kind of Stayo account');
  });

  it('VALIDATION_ERROR stays on the current step and is retryable in place', () => {
    const state = { ...initialClaimState(), step: 'confirm' as const, tenancies: [tenancy()], selectedTenantId: 't-1' };
    const next = claimReducer(state, { type: 'CONFIRM_FAILED', code: 'VALIDATION_ERROR', message: 'Invalid request' });
    expect(next.step).toBe('confirm');
    expect(next.error).toBe('Invalid request');
  });

  it('an unmapped code also stays put rather than being treated as fatal', () => {
    const state = { ...initialClaimState(), step: 'confirm' as const };
    const next = claimReducer(state, { type: 'CONFIRM_FAILED', code: 'SOMETHING_NEW', message: 'boom' });
    expect(next.step).toBe('confirm');
    expect(next.error).toBe('boom');
  });
});

describe('acknowledgements', () => {
  it('none of the five is pre-checked or implied by default', () => {
    expect(acknowledgementsComplete(emptyAcknowledgements())).toBe(false);
    for (const key of REQUIRED_ACKNOWLEDGEMENTS) {
      expect(emptyAcknowledgements()[key]).toBe(false);
    }
  });

  it('ACK_TOGGLED flips exactly the targeted key', () => {
    const state = { ...initialClaimState(), step: 'confirm' as const };
    const next = claimReducer(state, { type: 'ACK_TOGGLED', key: 'hostel_rules', value: true });
    expect(next.acknowledgements.hostel_rules).toBe(true);
    expect(next.acknowledgements.fee_refund_rules).toBe(false);
  });

  it('is only complete once every one of the five required keys is explicitly true', () => {
    for (const missing of REQUIRED_ACKNOWLEDGEMENTS) {
      const acks = allAcksTrue();
      acks[missing] = false;
      expect(acknowledgementsComplete(acks)).toBe(false);
    }
    expect(acknowledgementsComplete(allAcksTrue())).toBe(true);
  });
});

describe('canConfirm', () => {
  const confirmReady = (): ClaimState => ({
    ...initialClaimState(),
    step: 'confirm',
    tenancies: [tenancy()],
    selectedTenantId: 't-1',
    acknowledgements: allAcksTrue(),
    typedSignatureName: 'Priya Sharma',
  });

  it('is true once a tenancy is selected, every acknowledgement is true, and a signature is typed', () => {
    expect(canConfirm(confirmReady())).toBe(true);
  });

  it('is false with no tenancy selected', () => {
    expect(canConfirm({ ...confirmReady(), selectedTenantId: null })).toBe(false);
  });

  it('is false when any acknowledgement is missing', () => {
    const acks = allAcksTrue();
    acks.damage_liabilities = false;
    expect(canConfirm({ ...confirmReady(), acknowledgements: acks })).toBe(false);
  });

  it('is false without a typed signature -- never fabricated, never implied', () => {
    expect(canConfirm({ ...confirmReady(), typedSignatureName: '' })).toBe(false);
    expect(canConfirm({ ...confirmReady(), typedSignatureName: '   ' })).toBe(false);
  });
});

describe('FIELD_CHANGED', () => {
  it('updates the targeted optional field only', () => {
    const state = { ...initialClaimState(), step: 'confirm' as const };
    const next = claimReducer(state, { type: 'FIELD_CHANGED', field: 'name', value: 'Priya' });
    expect(next.name).toBe('Priya');
    expect(next.email).toBe('');
    const next2 = claimReducer(next, { type: 'FIELD_CHANGED', field: 'email', value: 'priya@example.com' });
    expect(next2.email).toBe('priya@example.com');
    expect(next2.name).toBe('Priya');
  });
});

describe('confirm submission', () => {
  it('CONFIRM_REQUESTED marks submitting', () => {
    const state = { ...initialClaimState(), step: 'confirm' as const };
    const next = claimReducer(state, { type: 'CONFIRM_REQUESTED' });
    expect(next.submitting).toBe(true);
  });

  it('CONFIRM_SUCCEEDED lands on done with the result attached', () => {
    const state = { ...initialClaimState(), step: 'confirm' as const, submitting: true };
    const result = { ...tenancy(), profile_id: 'p-1', access_mode: 'SELF_SERVE' };
    const next = claimReducer(state, { type: 'CONFIRM_SUCCEEDED', result });
    expect(next.step).toBe('done');
    expect(next.result).toEqual(result);
    expect(next.submitting).toBe(false);
  });
});

describe('RESTART', () => {
  it('resets all the way back to a fresh phone step from any terminal state', () => {
    const doneState: ClaimState = {
      ...initialClaimState(),
      step: 'done',
      phone: '9876543210',
      result: { ...tenancy(), profile_id: 'p-1', access_mode: 'SELF_SERVE' },
    };
    expect(claimReducer(doneState, { type: 'RESTART' })).toEqual(initialClaimState());

    const emptyState: ClaimState = { ...initialClaimState(), step: 'empty', phone: '9876543210' };
    expect(claimReducer(emptyState, { type: 'RESTART' })).toEqual(initialClaimState());
  });
});

describe('selectedTenancy', () => {
  it('resolves the tenancy object matching selectedTenantId', () => {
    const state = {
      ...initialClaimState(),
      tenancies: [tenancy({ tenant_id: 't-1' }), tenancy({ tenant_id: 't-2', hostel_name: 'Other PG' })],
      selectedTenantId: 't-2',
    };
    expect(selectedTenancy(state)?.hostel_name).toBe('Other PG');
  });

  it('is null when nothing is selected or the id matches nothing', () => {
    expect(selectedTenancy(initialClaimState())).toBeNull();
    const state = { ...initialClaimState(), tenancies: [tenancy()], selectedTenantId: 'ghost' };
    expect(selectedTenancy(state)).toBeNull();
  });
});
