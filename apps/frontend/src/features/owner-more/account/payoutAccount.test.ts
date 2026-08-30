import { describe, it, expect } from 'vitest';
import {
  validatePayoutDraft,
  toPayoutPayload,
  maskAccount,
  payoutRowSummary,
  normalizeIfsc,
  stripSpaces,
} from './payoutAccount';

const draft = (over: Partial<Parameters<typeof validatePayoutDraft>[0]> = {}) => ({
  holderName: 'Sathish Kumar',
  accountNo: '50100443219876',
  accountNoConfirm: '50100443219876',
  ifsc: 'HDFC0001204',
  bankName: 'HDFC Bank',
  ...over,
});

/**
 * The one form where a typo costs real money — a wrong digit sends an owner's
 * rent to a stranger, and nothing downstream can catch it.
 */
describe('validatePayoutDraft', () => {
  it('accepts a complete, matching account', () => {
    expect(validatePayoutDraft(draft())).toEqual({ ok: true });
  });

  it('refuses two account numbers that differ by a digit', () => {
    const check = validatePayoutDraft(draft({ accountNoConfirm: '50100443219875' }));
    expect(check.ok).toBe(false);
    expect(check.field).toBe('accountNoConfirm');
    expect(check.reason).toContain('wrong digit');
  });

  it('treats differently spaced versions of one number as the same', () => {
    // The check is for a wrong digit, not for different formatting. Refusing
    // "5010 0443" against "50100443" trains owners to stop reading the error.
    expect(validatePayoutDraft(draft({ accountNo: '5010 0443 2198 76' })).ok).toBe(true);
  });

  it('requires a holder name, because the bank matches on it', () => {
    expect(validatePayoutDraft(draft({ holderName: '   ' }))).toMatchObject({
      ok: false,
      field: 'holderName',
    });
  });

  it('refuses an account number that is not digits, or is too short', () => {
    expect(validatePayoutDraft(draft({ accountNo: '5010-4432', accountNoConfirm: '5010-4432' })))
      .toMatchObject({ ok: false, field: 'accountNo' });
    expect(validatePayoutDraft(draft({ accountNo: '123', accountNoConfirm: '123' })))
      .toMatchObject({ ok: false, field: 'accountNo' });
  });

  it('checks the IFSC shape and accepts it in any case', () => {
    expect(validatePayoutDraft(draft({ ifsc: 'hdfc0001204' })).ok).toBe(true);
    expect(validatePayoutDraft(draft({ ifsc: 'HDFC1001204' }))).toMatchObject({ ok: false, field: 'ifsc' });
    expect(validatePayoutDraft(draft({ ifsc: 'HDFC000120' }))).toMatchObject({ ok: false, field: 'ifsc' });
  });

  it('does not require a bank name, which the IFSC already identifies', () => {
    expect(validatePayoutDraft(draft({ bankName: '' })).ok).toBe(true);
  });

  it('reports the first problem only, so the owner fixes one thing at a time', () => {
    const check = validatePayoutDraft(draft({ holderName: '', ifsc: 'nope' }));
    expect(check.field).toBe('holderName');
  });
});

describe('toPayoutPayload', () => {
  it('sends the number without spaces and the IFSC upper-cased', () => {
    expect(toPayoutPayload(draft({ accountNo: '5010 0443', accountNoConfirm: '5010 0443', ifsc: 'hdfc0001204' })))
      .toEqual({
        holder_name: 'Sathish Kumar',
        account_no: '50100443',
        account_no_confirm: '50100443',
        ifsc: 'HDFC0001204',
        bank_name: 'HDFC Bank',
      });
  });

  it('trims the holder name rather than sending padding to the bank', () => {
    expect(toPayoutPayload(draft({ holderName: '  Sathish Kumar  ' })).holder_name).toBe('Sathish Kumar');
  });
});

describe('maskAccount', () => {
  it('shows the last four only', () => {
    expect(maskAccount('50100443219876')).toBe('••••9876');
  });

  it('is null when there is nothing worth masking', () => {
    expect(maskAccount('')).toBeNull();
    expect(maskAccount(null)).toBeNull();
    expect(maskAccount('12')).toBeNull();
  });
});

describe('payoutRowSummary', () => {
  it('says what is at stake when no account is on file', () => {
    // "Not set" describes a field. This describes the consequence.
    expect(payoutRowSummary(null)).toBe('Not added — payouts are on hold');
    expect(payoutRowSummary({ account_masked: null })).toBe('Not added — payouts are on hold');
  });

  it('names the bank alongside the masked number when both are known', () => {
    expect(payoutRowSummary({ account_masked: '••••9876', bank_name: 'HDFC Bank' })).toBe('HDFC Bank ••••9876');
  });

  it('falls back to the masked number alone', () => {
    expect(payoutRowSummary({ account_masked: '••••9876', bank_name: '' })).toBe('••••9876');
  });
});

describe('helpers', () => {
  it('strips every kind of space from an account number', () => {
    expect(stripSpaces(' 5010\t0443 ')).toBe('50100443');
  });

  it('upper-cases and trims an IFSC', () => {
    expect(normalizeIfsc('  hdfc0001204 ')).toBe('HDFC0001204');
  });
});
