import { describe, expect, it } from 'vitest';
import { identityIssues, passwordIssues, agreementIssues, summarise, type IdentityState } from './stepIssues';

/**
 * What the tenant is still missing, in the order it appears on screen.
 *
 * Every message has to name the thing and say what to do with it: at the
 * volume this flow is about to see, "Invalid input" is a support call.
 */

const base: IdentityState = {
  showAccountFields: true,
  phone: '9876543210',
  otp: '123456',
  otpSent: true,
  phoneTrust: null,
  emailRequirement: { required: true, email: null, verified_email: null },
  email: 'shiva@gmail.com',
  emailVerifiedAs: 'shiva@gmail.com',
  genderRequired: true,
  gender: 'Male',
  dateOfBirth: '2004-03-12',
  profileType: 'STUDENT',
  guardianName: 'Ramesh Kumar',
  guardianPhone: '9988776655',
  guardianVerified: true,
  photoUploaded: true,
  docItems: [
    { doc_type: 'AADHAAR', document_status: 'PENDING' },
    { doc_type: 'COLLEGE_ID', document_status: 'PENDING' },
  ],
};

describe('identityIssues', () => {
  it('finds nothing wrong with a complete identity step', () => {
    expect(identityIssues(base)).toEqual([]);
  });

  it('lists problems top-to-bottom, matching the order of the form', () => {
    const fields = identityIssues({
      ...base,
      phone: '',
      photoUploaded: false,
      gender: '',
      dateOfBirth: '',
      guardianName: '',
      guardianPhone: '',
      guardianVerified: false,
      docItems: [],
    }).map((i) => i.field);

    expect(fields).toEqual(['photo', 'phone', 'gender', 'date_of_birth', 'guardian_name', 'guardian_phone', 'doc:AADHAAR', 'doc:COLLEGE_ID']);
  });

  it('asks for the code only once a code has been sent', () => {
    expect(identityIssues({ ...base, otp: '', otpSent: false }).map((i) => i.field)).toEqual(['phone']);
    expect(identityIssues({ ...base, otp: '', otpSent: true })[0]).toMatchObject({ field: 'otp' });
  });

  it("names the number the code went to, so the tenant knows which phone to check", () => {
    const [issue] = identityIssues({ ...base, otp: '12', otpSent: true });
    expect(issue.message).toContain('9876543210');
  });

  it('does not ask for a code when the invitation already proved the number', () => {
    const trusted = { ...base, otp: '', otpSent: false, phoneTrust: { phone: '9876543210', trusted: true } };
    expect(identityIssues(trusted)).toEqual([]);
  });

  it('requires a verified email only while one is required', () => {
    expect(identityIssues({ ...base, emailVerifiedAs: null })[0]).toMatchObject({ field: 'email' });
    expect(identityIssues({ ...base, emailVerifiedAs: null, emailRequirement: { required: false, email: null, verified_email: null } })).toEqual([]);
  });

  it('asks a working professional for a guardian only if they started entering one', () => {
    const pro = { ...base, profileType: 'WORKING_PROFESSIONAL', guardianName: '', guardianPhone: '', guardianVerified: false, docItems: [{ doc_type: 'AADHAAR', document_status: 'PENDING' }, { doc_type: 'WORK_ID', document_status: 'PENDING' }] };
    expect(identityIssues(pro)).toEqual([]);
    // Half a guardian is no use to anyone: start one, and both the name and a
    // usable number are asked for.
    expect(identityIssues({ ...pro, guardianPhone: '99887' }).map((i) => i.field)).toEqual(['guardian_name', 'guardian_phone']);
  });

  it('treats a rejected document as still outstanding, and says why', () => {
    const rejected = identityIssues({ ...base, docItems: [{ doc_type: 'AADHAAR', document_status: 'REJECTED' }, { doc_type: 'COLLEGE_ID', document_status: 'PENDING' }] });
    expect(rejected.map((i) => i.field)).toEqual(['doc:AADHAAR']);
    expect(rejected[0].message).toMatch(/again/i);
  });

  it('skips the account fields once the number and email are already saved', () => {
    expect(identityIssues({ ...base, showAccountFields: false, phone: '', otp: '', emailVerifiedAs: null })).toEqual([]);
  });

  it('never says "invalid" — every message names the field and the action', () => {
    const all = identityIssues({ ...base, phone: '', photoUploaded: false, gender: '', dateOfBirth: '', guardianName: '', guardianVerified: false, docItems: [] });
    for (const issue of all) {
      expect(issue.message).not.toMatch(/invalid/i);
      expect(issue.message.length).toBeGreaterThan(10);
      expect(issue.label.length).toBeGreaterThan(2);
    }
  });
});

describe('passwordIssues', () => {
  it('accepts a long enough, matching password', () => {
    expect(passwordIssues({ password: 'longenough1', confirm: 'longenough1' })).toEqual([]);
  });
  it('asks for length before match, and points at the field that is wrong', () => {
    expect(passwordIssues({ password: 'short', confirm: '' })[0]).toMatchObject({ field: 'password' });
    expect(passwordIssues({ password: 'longenough1', confirm: 'longenough2' })[0]).toMatchObject({ field: 'confirm_password' });
  });
});

describe('agreementIssues', () => {
  it('wants every rule ticked before the signatures', () => {
    const issues = agreementIssues({ acknowledgements: { rules: true, dues: false }, tenantSignature: false, tenantSignatureName: '', guardianSignature: false, guardianSignatureName: '', guardianRelation: '' });
    expect(issues[0]).toMatchObject({ field: 'ack:dues' });
  });
  it('accepts either signature, but wants a name with it', () => {
    const ticked = { acknowledgements: { rules: true }, guardianSignature: false, guardianSignatureName: '', guardianRelation: '' };
    expect(agreementIssues({ ...ticked, tenantSignature: true, tenantSignatureName: 'Shiva' })).toEqual([]);
    expect(agreementIssues({ ...ticked, tenantSignature: true, tenantSignatureName: '' })[0]).toMatchObject({ field: 'tenant_signature_name' });
    expect(agreementIssues({ ...ticked, tenantSignature: false, tenantSignatureName: '' })[0]).toMatchObject({ field: 'tenant_signature' });
  });
  it('wants the relationship when a guardian signs', () => {
    const issues = agreementIssues({ acknowledgements: { rules: true }, tenantSignature: true, tenantSignatureName: 'Shiva', guardianSignature: true, guardianSignatureName: 'Ramesh', guardianRelation: '' });
    expect(issues[0]).toMatchObject({ field: 'guardian_relation' });
  });
});

describe('summarise — the line above the action bar', () => {
  const issues = [
    { field: 'date_of_birth', label: 'Date of birth', message: 'Add your date of birth.' },
    { field: 'doc:AADHAAR', label: 'Aadhaar', message: 'Upload your Aadhaar.' },
  ];

  it('counts what is left rather than what is wrong', () => {
    // Goal-gradient: progress language, not blame.
    expect(summarise(issues)).toBe('2 things left');
    expect(summarise(issues.slice(0, 1))).toBe('1 thing left');
  });

  it('says nothing when nothing is outstanding', () => {
    expect(summarise([])).toBe('');
  });
});
