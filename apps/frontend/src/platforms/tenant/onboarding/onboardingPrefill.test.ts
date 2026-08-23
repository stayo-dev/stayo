import { describe, it, expect } from 'vitest';
import { buildPrefillPlan, type KnownBlock } from './onboardingPrefill';

const known = (over: Partial<KnownBlock> = {}): KnownBlock => ({
  name: 'Asha',
  email: 'asha@example.com',
  phone: '9876543210',
  phone_verified: true,
  has_prefill: true,
  identity: {},
  source_of: {},
  ...over,
});

describe('buildPrefillPlan', () => {
  it('requires no OTP when the phone is verified and untouched', () => {
    const plan = buildPrefillPlan({ known: known(), profileType: 'STUDENT', phoneEdited: false });
    expect(plan.otpRequired).toBe(false);
  });

  it('requires an OTP once the tenant edits the verified phone', () => {
    const plan = buildPrefillPlan({ known: known(), profileType: 'STUDENT', phoneEdited: true });
    expect(plan.otpRequired).toBe(true);
  });

  it('requires an OTP when the phone was never verified', () => {
    const plan = buildPrefillPlan({
      known: known({ phone_verified: false }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(plan.otpRequired).toBe(true);
  });

  it('shows the known block only when there is something to show', () => {
    const empty = buildPrefillPlan({
      known: known({ has_prefill: false, identity: {} }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(empty.showKnownBlock).toBe(false);

    const filled = buildPrefillPlan({
      known: known({ identity: { gender: 'Female', date_of_birth: '2004-03-14' } }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(filled.showKnownBlock).toBe(true);
  });

  it('lists student rows for a student and work rows for a professional', () => {
    const student = buildPrefillPlan({
      known: known({ identity: { college_name: 'NIT Warangal', office_name: 'Acme' } }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    const fields = student.knownRows.map((row) => row.field);
    expect(fields).toContain('college_name');
    expect(fields).not.toContain('office_name');

    const pro = buildPrefillPlan({
      known: known({ identity: { college_name: 'NIT Warangal', office_name: 'Acme' } }),
      profileType: 'WORKING_PROFESSIONAL',
      phoneEdited: false,
    });
    const proFields = pro.knownRows.map((row) => row.field);
    expect(proFields).toContain('office_name');
    expect(proFields).not.toContain('college_name');
  });

  it('omits rows with no value, and labels where each value came from', () => {
    const plan = buildPrefillPlan({
      known: known({
        identity: { gender: 'Female', date_of_birth: null, guardian_name: 'Ramesh' },
        source_of: { gender: 'PROFILE', guardian_name: 'TENANCY' },
      }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    const fields = plan.knownRows.map((row) => row.field);
    expect(fields).toContain('gender');
    expect(fields).not.toContain('date_of_birth');
    expect(plan.knownRows.find((row) => row.field === 'gender')?.origin).toBe('PROFILE');
    expect(plan.knownRows.find((row) => row.field === 'guardian_name')?.origin).toBe('TENANCY');
  });

  it('degrades to a plain form when there is no known block at all', () => {
    const plan = buildPrefillPlan({ known: undefined, profileType: 'STUDENT', phoneEdited: false });
    expect(plan.showKnownBlock).toBe(false);
    expect(plan.otpRequired).toBe(true);
    expect(plan.account.name).toBe('');
    expect(plan.knownRows).toEqual([]);
  });

  it('formats a date of birth for reading, not for an input', () => {
    const plan = buildPrefillPlan({
      known: known({ identity: { date_of_birth: '2004-03-14T00:00:00.000Z' } }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(plan.knownRows.find((row) => row.field === 'date_of_birth')?.display).toBe('14 Mar 2004');
  });
});
