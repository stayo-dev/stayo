import { describe, expect, it } from 'vitest';
import {
  buildPlatformLeadFromEnquiry,
  buildPlatformLeadFromReferral,
  referralNote,
} from '@/src/services/marketing/platform-listing-leads';

describe('who sourced a lead', () => {
  it('labels a Discover demand lead, so it cannot read as an owner signup', () => {
    const lead = buildPlatformLeadFromEnquiry({ id: 'h1', name: 'Sunrise', city: 'Pune', listing_source: 'PLATFORM_LISTED' });
    expect(lead.acquisition_source).toBe('DISCOVER_DEMAND');
    expect(lead.phone).toBe('');
  });

  it('labels a student referral and names the hostel as the prospect', () => {
    const lead = buildPlatformLeadFromReferral({ hostelName: '  Sri Sai Boys Hostel ' });
    expect(lead.acquisition_source).toBe('STUDENT_REFERRAL');
    expect(lead.name).toBe('Sri Sai Boys Hostel');
    expect(lead.hostel_name).toBe('Sri Sai Boys Hostel');
  });

  it("never puts the student-supplied owner number in `phone`", () => {
    const lead = buildPlatformLeadFromReferral({ hostelName: 'Sri Sai', ownerContact: '9876543210' });
    expect(lead.phone).toBe('');
    expect(lead.notes).toContain('9876543210');
    expect(lead.notes).toContain('not opted in');
  });
});

describe('referralNote', () => {
  it('starts a tally on the first referral', () => {
    expect(referralNote(null, null)).toBe('Student referral · 1 referral');
  });

  it('counts repeats, because the count is the pitch', () => {
    const once = referralNote(null, null);
    expect(referralNote(once, null)).toBe('Student referral · 2 referrals');
    expect(referralNote(referralNote(once, null), null)).toBe('Student referral · 3 referrals');
  });

  it("keeps an admin's own notes above the tally", () => {
    const withNote = referralNote('Called, no answer', null);
    expect(withNote.startsWith('Called, no answer')).toBe(true);
    expect(withNote).toContain('Student referral · 1 referral');
    expect(referralNote(withNote, null)).toContain('Called, no answer');
  });

  it('appends an owner number the lead did not already have', () => {
    const first = referralNote(null, null);
    const second = referralNote(first, '9876543210');
    expect(second).toContain('2 referrals');
    expect(second).toContain('9876543210');
  });

  it('does not repeat a number it already holds', () => {
    const first = referralNote(null, '9876543210');
    const second = referralNote(first, '9876543210');
    expect(second.match(/9876543210/g)).toHaveLength(1);
  });
});
