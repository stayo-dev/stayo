import { describe, it, expect } from 'vitest';
import {
  guardianBadge,
  guardianPromptCopy,
  guardianDeferralAcknowledgement,
  formatGuardianDeadline,
  GUARDIAN_DEFERRAL_REASONS,
} from './guardianVerification';

describe('guardianBadge', () => {
  it('shows nothing when no guardian is expected', () => {
    expect(guardianBadge('NOT_APPLICABLE')).toBeNull();
  });

  it('is quiet and non-actionable in a hostel that does not chase it', () => {
    const badge = guardianBadge('PENDING_UNCHASED')!;
    expect(badge.label).toBe('Not verified');
    expect(badge.tone).toBe('neutral');
    expect(badge.actionable).toBe(false);
  });

  it('offers an action only where the hostel actually chases it', () => {
    expect(guardianBadge('PENDING_GRACE')!.actionable).toBe(true);
    expect(guardianBadge('PENDING_OVERDUE')!.actionable).toBe(true);
  });

  it('never reaches for danger, even when overdue', () => {
    // A parent who has not tapped a button has done nothing wrong.
    for (const state of ['PENDING_UNCHASED', 'PENDING_GRACE', 'PENDING_OVERDUE'] as const) {
      expect(guardianBadge(state)!.tone).not.toBe('danger');
    }
  });

  it('says the same word whether or not the hostel chases it', () => {
    // "Not verified" is a fact. The tone carries the urgency, not the wording,
    // so an owner reading two hostels' lists reads one vocabulary.
    expect(guardianBadge('PENDING_UNCHASED')!.label).toBe(guardianBadge('PENDING_OVERDUE')!.label);
  });
});

describe('formatGuardianDeadline', () => {
  it('formats a date the tenant can hold us to', () => {
    expect(formatGuardianDeadline('2026-09-23T10:00:00.000Z')).toMatch(/23 Sep/);
  });

  it('returns null rather than "Invalid Date" for junk', () => {
    expect(formatGuardianDeadline(null)).toBeNull();
    expect(formatGuardianDeadline('not a date')).toBeNull();
  });
});

describe('guardianPromptCopy', () => {
  it('addresses the guardian by name when we have one', () => {
    const copy = guardianPromptCopy('PENDING_GRACE', 'Amma', '2026-09-23T10:00:00.000Z')!;
    expect(copy.title).toContain('Amma');
    expect(copy.primaryAction).toContain('Amma');
  });

  it('falls back gracefully when the name is missing', () => {
    const copy = guardianPromptCopy('PENDING_GRACE', '   ', null)!;
    expect(copy.title).toContain('your guardian');
    expect(copy.title).not.toContain('undefined');
  });

  it('names the date it will ask again', () => {
    const copy = guardianPromptCopy('PENDING_GRACE', 'Amma', '2026-09-23T10:00:00.000Z')!;
    expect(copy.body).toMatch(/23 Sep/);
  });

  it('leads the overdue prompt with what the guardian gains, not what we want', () => {
    const copy = guardianPromptCopy('PENDING_OVERDUE', 'Amma', null)!;
    expect(copy.body).toMatch(/see your rent|pay it for you|reached/);
    expect(copy.body).not.toMatch(/required|must|policy/i);
  });

  it('always offers a way out', () => {
    for (const state of ['PENDING_GRACE', 'PENDING_OVERDUE', 'PENDING_UNCHASED'] as const) {
      expect(guardianPromptCopy(state, 'Amma', null)!.secondaryAction.trim()).not.toBe('');
    }
  });

  it('says nothing at all once verified', () => {
    expect(guardianPromptCopy('VERIFIED', 'Amma', null)).toBeNull();
    expect(guardianPromptCopy('NOT_APPLICABLE', null, null)).toBeNull();
  });
});

describe('guardianDeferralAcknowledgement', () => {
  it('names the date, so the obligation is bounded rather than looming', () => {
    expect(guardianDeferralAcknowledgement('2026-09-23T10:00:00.000Z', true)).toMatch(/23 Sep/);
  });

  it('promises nothing it will not do in a hostel that does not chase', () => {
    const message = guardianDeferralAcknowledgement('2026-09-23T10:00:00.000Z', false);
    expect(message).not.toMatch(/23 Sep/);
    expect(message).toMatch(/any time/i);
  });

  it('degrades to a week rather than printing a broken date', () => {
    expect(guardianDeferralAcknowledgement(null, true)).toMatch(/a week/);
  });
});

describe('GUARDIAN_DEFERRAL_REASONS', () => {
  it('offers the obstacles a hostel can actually act on', () => {
    const values = GUARDIAN_DEFERRAL_REASONS.map((reason) => reason.value);
    // "No WhatsApp" is the one no amount of reminding fixes and a phone call
    // fixes in a minute — the reason the question is worth asking at all.
    expect(values).toContain('NO_WHATSAPP');
    expect(values).toContain('PREFER_NOT_TO');
  });

  it('phrases every option as the tenant would say it, not as a form field', () => {
    for (const reason of GUARDIAN_DEFERRAL_REASONS) {
      expect(reason.label).toMatch(/[a-z]/);
      expect(reason.label).not.toBe(reason.value);
    }
  });
});
