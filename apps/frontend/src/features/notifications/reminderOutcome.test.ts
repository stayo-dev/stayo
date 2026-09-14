import { describe, it, expect } from 'vitest';
import { describeReminderOutcome } from './reminderOutcome';

/**
 * The regression these cover: every one of the failing shapes below used to
 * render "Reminder sent". The first case is the real outage — Meta rejecting
 * the template name — and it must never again read as success.
 */
describe('describeReminderOutcome', () => {
  it('reports a WhatsApp provider rejection as a failure, not a send', () => {
    const outcome = describeReminderOutcome({
      success: true,
      tenant_name: 'Demo Tenant',
      channels: {
        in_app: { attempted: false, sent: false, skipped: true, reason: 'NO_TENANT_ACCOUNT' },
        email: { attempted: false, sent: false, skipped: true, reason: 'TENANT_EMAIL_MISSING' },
        whatsapp: { attempted: true, sent: false, error_code: '132001' },
      },
    });

    expect(outcome.tone).toBe('error');
    expect(outcome.delivered).toBe(false);
    expect(outcome.message).toContain('132001');
    expect(outcome.message).not.toMatch(/^Reminder sent/);
  });

  it('reports a partial send as a warning when another channel landed', () => {
    const outcome = describeReminderOutcome({
      success: true,
      tenant_name: 'Demo Tenant',
      channels: {
        in_app: { attempted: true, sent: true },
        email: { attempted: true, sent: true },
        whatsapp: { attempted: true, sent: false, error_code: '132001' },
      },
    });

    expect(outcome.tone).toBe('warning');
    expect(outcome.delivered).toBe(false);
    expect(outcome.message).toContain('whatsapp failed');
    expect(outcome.message).toContain('132001');
  });

  it('surfaces an explicit success:false body even though it arrives as HTTP 200', () => {
    const outcome = describeReminderOutcome({
      success: false,
      message: 'No unpaid obligations found for Demo Tenant',
      tenant_name: 'Demo Tenant',
    });

    expect(outcome.tone).toBe('error');
    expect(outcome.delivered).toBe(false);
    expect(outcome.message).toBe('No unpaid obligations found for Demo Tenant');
  });

  it('treats a channel the owner switched off as success, not a warning', () => {
    const outcome = describeReminderOutcome({
      success: true,
      message: 'WhatsApp reminder sent to Demo Tenant',
      tenant_name: 'Demo Tenant',
      channels: {
        in_app: { attempted: true, sent: true },
        email: { attempted: false, sent: false, skipped: true, reason: 'EMAIL_DISABLED' },
        whatsapp: { attempted: true, sent: true },
      },
    });

    expect(outcome.tone).toBe('success');
    expect(outcome.delivered).toBe(true);
    expect(outcome.message).toBe('WhatsApp reminder sent to Demo Tenant');
  });

  it('warns when a send was skipped for a reason the owner did not choose', () => {
    const outcome = describeReminderOutcome({
      success: true,
      tenant_name: 'Demo Tenant',
      channels: {
        in_app: { attempted: true, sent: true },
        whatsapp: { attempted: false, sent: false, skipped: true, reason: 'DUPLICATE_REMINDER' },
      },
    });

    expect(outcome.tone).toBe('warning');
    expect(outcome.message).toContain('duplicate reminder');
  });

  it('reports nothing-delivered when every channel was skipped by configuration', () => {
    const outcome = describeReminderOutcome({
      success: true,
      tenant_name: 'Demo Tenant',
      channels: {
        in_app: { attempted: false, sent: false, skipped: true, reason: 'NO_TENANT_ACCOUNT' },
        email: { attempted: false, sent: false, skipped: true, reason: 'TENANT_EMAIL_MISSING' },
        whatsapp: { attempted: false, sent: false, skipped: true, reason: 'WHATSAPP_DISABLED' },
      },
    });

    expect(outcome.tone).toBe('error');
    expect(outcome.delivered).toBe(false);
    expect(outcome.message).toContain('whatsapp disabled');
  });

  it('never claims success for an empty or missing body', () => {
    for (const input of [undefined, null, {}]) {
      const outcome = describeReminderOutcome(input as never);
      expect(outcome.tone).toBe('error');
      expect(outcome.delivered).toBe(false);
    }
  });
});
