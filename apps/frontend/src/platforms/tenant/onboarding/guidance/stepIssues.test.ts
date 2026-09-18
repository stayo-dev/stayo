import { describe, expect, it } from 'vitest';
import {
  identityIssues,
  guardianIssues,
  passwordIssues,
  agreementIssues,
  summarise,
  type IdentityState,
  type GuardianState,
} from './stepIssues';

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
      docItems: [],
    }).map((i) => i.field);

    // The order is the order on screen — the UI walks this list to decide where
    // to scroll, so it is a contract, not an incidental.
    expect(fields).toEqual(['photo', 'phone', 'gender', 'date_of_birth', 'doc:AADHAAR', 'doc:COLLEGE_ID']);
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

  it('says nothing about a guardian — that screen owns its own rules now', () => {
    // ADR-213. Leaving them here is what made Continue on Identity report
    // things left to do and then scroll to controls that were not rendered.
    const fields = identityIssues({ ...base, photoUploaded: false, gender: '' }).map((i) => i.field);
    expect(fields.some((f) => f.startsWith('guardian'))).toBe(false);
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
    const all = identityIssues({ ...base, phone: '', photoUploaded: false, gender: '', dateOfBirth: '', docItems: [] });
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
  /** Read and ticked: the state everything else varies from. */
  const base = {
    acknowledgements: { rules: true },
    readCompleted: true,
    tenantSignature: true,
    tenantSignatureName: 'Shiva',
    guardianSignature: false,
    guardianSignatureName: '',
    guardianRelation: '',
  };

  it('wants every rule ticked before the signatures', () => {
    const issues = agreementIssues({ ...base, acknowledgements: { rules: true, dues: false } });
    expect(issues[0]).toMatchObject({ field: 'ack:dues' });
  });

  it('is satisfied by a read document, ticked rules and a signed name', () => {
    expect(agreementIssues(base)).toEqual([]);
  });

  it('wants a typed name with the signature', () => {
    expect(agreementIssues({ ...base, tenantSignatureName: '' })[0]).toMatchObject({ field: 'tenant_signature_name' });
  });

  it('wants the relationship when a guardian signs', () => {
    const issues = agreementIssues({ ...base, guardianSignature: true, guardianSignatureName: 'Ramesh' });
    expect(issues[0]).toMatchObject({ field: 'guardian_relation' });
  });

  // ── The read gate ──────────────────────────────────────────────────────
  it('blocks signing until the document has been read to the end', () => {
    const issues = agreementIssues({ ...base, readCompleted: false });
    expect(issues.some((i) => i.field === 'agreement_document')).toBe(true);
  });

  it('asks for the read before it asks for a signature', () => {
    // There is no point telling someone to sign a document they have not opened.
    const issues = agreementIssues({
      ...base, readCompleted: false, tenantSignature: false, tenantSignatureName: '',
    });
    expect(issues[0].field).toBe('agreement_document');
  });

  it('stops asking once the document has been read', () => {
    expect(agreementIssues(base).some((i) => i.field === 'agreement_document')).toBe(false);
  });

  // ── The tenant must sign ───────────────────────────────────────────────
  it('does not accept a guardian signature in place of the tenant\'s', () => {
    // "tenant, guardian, or both" is exactly what allowed a tenancy to be
    // activated with no signature from the person who lives there.
    const issues = agreementIssues({
      ...base,
      tenantSignature: false,
      tenantSignatureName: '',
      guardianSignature: true,
      guardianSignatureName: 'Ramesh',
      guardianRelation: 'Father',
    });
    expect(issues.some((i) => i.field === 'tenant_signature')).toBe(true);
  });

  it('accepts the tenant signing alone when no guardian is required', () => {
    expect(agreementIssues({ ...base, guardianRequired: false })).toEqual([]);
  });

  // ── Guardian co-signature, when the hostel asks for one ────────────────
  it('requires a guardian signature when the hostel policy asks for one', () => {
    const issues = agreementIssues({ ...base, guardianRequired: true });
    expect(issues.some((i) => i.field === 'guardian_signature')).toBe(true);
  });

  it('requires the guardian name and relationship too when one is required', () => {
    const signed = { ...base, guardianRequired: true, guardianSignature: true };
    expect(agreementIssues(signed).some((i) => i.field === 'guardian_signature_name')).toBe(true);
    expect(agreementIssues({ ...signed, guardianSignatureName: 'Ramesh' })[0])
      .toMatchObject({ field: 'guardian_relation' });
  });

  it('is satisfied by a complete guardian co-signature when one is required', () => {
    expect(agreementIssues({
      ...base,
      guardianRequired: true,
      guardianSignature: true,
      guardianSignatureName: 'Ramesh',
      guardianRelation: 'Father',
    })).toEqual([]);
  });

  it('treats an absent guardianRequired flag as not required', () => {
    // Matches the backend default: a hostel predating the setting must not
    // suddenly block its tenants.
    expect(agreementIssues(base)).toEqual([]);
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

describe('guardianIssues', () => {
  const guardian: GuardianState = {
    name: 'Ramesh Kumar',
    relation: 'Father',
    phone: '9988776655',
    verified: true,
    deferralReason: null,
  };

  it('finds nothing wrong with a complete, verified guardian', () => {
    expect(guardianIssues(guardian)).toEqual([]);
  });

  it('asks for all three fields, in the order they appear on screen', () => {
    const fields = guardianIssues({ ...guardian, name: '', relation: '', phone: '' }).map((i) => i.field);
    expect(fields).toEqual(['guardian_name', 'guardian_relation', 'guardian_phone']);
  });

  it('asks for the relationship, which the old flow never collected', () => {
    const [issue] = guardianIssues({ ...guardian, relation: '' });
    expect(issue).toMatchObject({ field: 'guardian_relation' });
    expect(issue.message).toMatch(/related/i);
  });

  it('asks for a usable number before it asks about verifying one', () => {
    const [issue] = guardianIssues({ ...guardian, phone: '99887', verified: false });
    expect(issue.field).toBe('guardian_phone');
    expect(issue.message).toMatch(/10-digit/);
  });

  it('names all three ways out when the number is unverified', () => {
    // "Verify this number" is true and useless to someone whose parent is not
    // picking up — the case this step exists to handle.
    const [issue] = guardianIssues({ ...guardian, verified: false });
    expect(issue.message).toMatch(/confirm/i);
    expect(issue.message).toMatch(/code/i);
    expect(issue.message).toMatch(/can.t right now/i);
  });

  it('stops asking once the tenant has said they cannot verify now', () => {
    // ADR-212 made deferral a legitimate way through; guidance that kept
    // asking would be demanding something the product already accepted.
    expect(guardianIssues({ ...guardian, verified: false, deferralReason: 'NO_WHATSAPP' })).toEqual([]);
  });

  it('never says "invalid" — every message names the field and the action', () => {
    const all = guardianIssues({ name: '', relation: '', phone: '', verified: false, deferralReason: null });
    for (const issue of all) {
      expect(issue.message).not.toMatch(/invalid/i);
      expect(issue.message.length).toBeGreaterThan(10);
      expect(issue.label.length).toBeGreaterThan(2);
    }
  });
});
