import { describe, expect, it } from 'vitest';
import { normalizeQuery, parseCoverageDetails, parseCoverageRequest } from '@/src/services/discovery/coverage-request-rules';

describe('normalizeQuery', () => {
  it('lower-cases and collapses whitespace so the same campus aggregates', () => {
    expect(normalizeQuery('  Osmania   UNIVERSITY ')).toBe('osmania university');
  });
});

describe('parseCoverageRequest', () => {
  it('accepts an area with no contact', () => {
    const parsed = parseCoverageRequest({ area_query: ' Osmania University ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('AREA');
    expect(parsed.value.areaQuery).toBe('Osmania University');
    expect(parsed.value.normalizedQuery).toBe('osmania university');
    expect(parsed.value.contactPhone).toBeNull();
    expect(parsed.value.contactEmail).toBeNull();
    expect(parsed.value.source).toBe('HOME');
  });

  it('stores an Indian mobile as ten local digits', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', contact: '+91 98765 43210' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.contactPhone).toBe('9876543210');
    expect(parsed.value.contactEmail).toBeNull();
  });

  it('lower-cases an email contact', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', contact: 'A@B.CO' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.contactEmail).toBe('a@b.co');
  });

  it('rejects a missing, short or over-long area', () => {
    expect(parseCoverageRequest({}).ok).toBe(false);
    expect(parseCoverageRequest({ area_query: 'a' }).ok).toBe(false);
    expect(parseCoverageRequest({ area_query: 'x'.repeat(121) }).ok).toBe(false);
  });

  it('rejects a non-string area rather than coercing it', () => {
    const parsed = parseCoverageRequest({ area_query: 42 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe('INVALID_AREA');
  });

  it('rejects a malformed contact', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', contact: 'nope' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe('INVALID_CONTACT');
  });

  it('falls back to HOME for an unknown source rather than trusting the client', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', source: 'DROP TABLE' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.source).toBe('HOME');
  });

  it('accepts a hostel referral with just a name', () => {
    const parsed = parseCoverageRequest({ kind: 'HOSTEL', hostel_name: ' Sri Sai Boys Hostel ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('HOSTEL');
    expect(parsed.value.hostelName).toBe('Sri Sai Boys Hostel');
    expect(parsed.value.areaQuery).toBeNull();
    expect(parsed.value.normalizedQuery).toBeNull();
    expect(parsed.value.ownerContact).toBeNull();
  });

  it("keeps the owner's number on a referral, as ten local digits", () => {
    const parsed = parseCoverageRequest({ kind: 'HOSTEL', hostel_name: 'Sri Sai', owner_contact: '+91 98765 43210' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ownerContact).toBe('9876543210');
  });

  it('rejects a referral with no usable hostel name', () => {
    expect(parseCoverageRequest({ kind: 'HOSTEL' }).ok).toBe(false);
    expect(parseCoverageRequest({ kind: 'HOSTEL', hostel_name: 'ab' }).ok).toBe(false);
  });

  it('treats an unknown kind as AREA rather than failing', () => {
    const parsed = parseCoverageRequest({ kind: 'WHATEVER', area_query: 'BITS' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('AREA');
  });
});

describe('parseCoverageDetails — the second step of a referral', () => {
  it('accepts just the owner number, as ten local digits', () => {
    const parsed = parseCoverageDetails({ owner_contact: '+91 98765 43210' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ownerContact).toBe('9876543210');
    expect(parsed.value.areaQuery).toBeNull();
  });

  it('accepts just the area, for the student who does not know the number', () => {
    const parsed = parseCoverageDetails({ area_query: '  Ameerpet  ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.areaQuery).toBe('Ameerpet');
    expect(parsed.value.normalizedQuery).toBe('ameerpet');
    expect(parsed.value.ownerContact).toBeNull();
  });

  it('accepts both together', () => {
    const parsed = parseCoverageDetails({ owner_contact: '9876543210', area_query: 'Ameerpet' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ownerContact).toBe('9876543210');
    expect(parsed.value.areaQuery).toBe('Ameerpet');
  });

  it('rejects an empty patch rather than reporting success', () => {
    expect(parseCoverageDetails({}).ok).toBe(false);
    expect(parseCoverageDetails({ owner_contact: '   ', area_query: '' }).ok).toBe(false);
    const parsed = parseCoverageDetails({});
    if (parsed.ok) return;
    expect(parsed.error).toBe('EMPTY');
  });

  it('rejects a malformed number', () => {
    const parsed = parseCoverageDetails({ owner_contact: '12345' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe('INVALID_CONTACT');
  });

  it('rejects an area that is too short or too long', () => {
    expect(parseCoverageDetails({ area_query: 'a' }).ok).toBe(false);
    expect(parseCoverageDetails({ area_query: 'x'.repeat(121) }).ok).toBe(false);
  });
});
