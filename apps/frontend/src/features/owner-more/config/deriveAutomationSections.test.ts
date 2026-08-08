import { describe, expect, it } from 'vitest';
import {
  buildWorkflowPatch,
  countWorkflows,
  deriveAutomationSections,
  type AutomationSource,
} from './deriveAutomationSections';

/**
 * Automation is the one configuration screen whose rows *write*: each is a live
 * toggle over `policy.automation` or `policy.reminders.channels`, and those
 * flags gate real cron jobs. So both halves are tested here — what a row
 * displays, and the exact PATCH body a toggle sends.
 */
const source = (overrides: Partial<AutomationSource> = {}): AutomationSource => ({
  automation: {
    auto_generate_rent: true,
    auto_apply_late_fees: true,
    auto_send_reminders: true,
    auto_email_receipts: true,
    auto_deactivate_days: 10,
    nightly_reconciliation: true,
    snapshot_generation: false,
  },
  channels: { email: true, in_app: true, whatsapp: true, sms: false },
  ...overrides,
});

const find = (s: AutomationSource, key: string) =>
  deriveAutomationSections(s).flatMap((section) => section.rows).find((r) => r.key === key)!;

describe('deriveAutomationSections', () => {
  it('shows a running workflow as enabled', () => {
    const row = find(source(), 'auto_generate_rent');

    expect(row.enabled).toBe(true);
    expect(row.state).toBe('configured');
  });

  it('shows a paused workflow as off rather than as a gap', () => {
    const row = find(source(), 'snapshot_generation');

    expect(row.enabled).toBe(false);
    // Paused on purpose is never "needs attention".
    expect(row.state).toBe('off');
  });

  it('reads overdue escalation from the day count, not a boolean', () => {
    expect(find(source(), 'auto_deactivate_days').enabled).toBe(true);
    expect(find(source(), 'auto_deactivate_days').detail).toContain('10');
  });

  it('treats zero escalation days as switched off', () => {
    const s = source();
    s.automation!.auto_deactivate_days = 0;

    expect(find(s, 'auto_deactivate_days').enabled).toBe(false);
  });

  it('reads communication channels from reminder policy', () => {
    expect(find(source(), 'channel_whatsapp').enabled).toBe(true);
    expect(find(source(), 'channel_email').enabled).toBe(true);
  });

  it('renders SMS as unavailable, because no SMS provider exists in the codebase', () => {
    // `reminders.channels.sms` is a real stored flag, but nothing sends an
    // SMS — no provider, no sender. A toggle that persists a preference which
    // changes nothing observable is worse than an honest placeholder.
    const row = find(source(), 'channel_sms');

    expect(row.state).toBe('unavailable');
    expect(row.enabled).toBeNull();
  });

  it('gives every writable row a policy path to patch', () => {
    const rows = deriveAutomationSections(source()).flatMap((s) => s.rows);
    const writable = rows.filter((r) => r.enabled !== null);

    expect(writable.length).toBeGreaterThan(0);
    for (const row of writable) expect(row.path).toBeTruthy();
  });

  it('gives unavailable rows no path, so they cannot be written', () => {
    const rows = deriveAutomationSections(source()).flatMap((s) => s.rows);

    for (const row of rows.filter((r) => r.state === 'unavailable')) {
      expect(row.path).toBeUndefined();
    }
  });
});

describe('countWorkflows', () => {
  it('counts running against real workflows only', () => {
    const rows = deriveAutomationSections(source()).flatMap((s) => s.rows);
    const { running, total } = countWorkflows(rows);

    // Unavailable rows must not inflate the denominator — the banner would
    // otherwise claim workflows exist that nobody can run.
    expect(total).toBe(rows.filter((r) => r.enabled !== null).length);
    expect(running).toBeLessThanOrEqual(total);
  });

  it('counts nothing as running when everything is paused', () => {
    const rows = deriveAutomationSections(
      source({
        automation: {
          auto_generate_rent: false,
          auto_apply_late_fees: false,
          auto_send_reminders: false,
          auto_email_receipts: false,
          auto_deactivate_days: 0,
          nightly_reconciliation: false,
          snapshot_generation: false,
        },
        channels: { email: false, in_app: false, whatsapp: false, sms: false },
      }),
    ).flatMap((s) => s.rows);

    expect(countWorkflows(rows).running).toBe(0);
  });
});

describe('buildWorkflowPatch', () => {
  it('nests a boolean flag under its domain', () => {
    const row = find(source(), 'auto_generate_rent');

    expect(buildWorkflowPatch(row, false)).toEqual({ automation: { auto_generate_rent: false } });
  });

  it('nests a channel flag two levels deep', () => {
    const row = find(source(), 'channel_whatsapp');

    // reminders.channels, not notifications.channels: only the former reaches
    // the flat prefs reminder-service.ts gates real sends on.
    expect(buildWorkflowPatch(row, false)).toEqual({ reminders: { channels: { whatsapp: false } } });
  });

  it('writes a day count rather than a boolean for overdue escalation', () => {
    const row = find(source(), 'auto_deactivate_days');

    // Turning it on must restore a usable threshold, not `true` — the backend
    // validates this field as a number between 0 and 365.
    expect(buildWorkflowPatch(row, true)).toEqual({ automation: { auto_deactivate_days: 10 } });
    expect(buildWorkflowPatch(row, false)).toEqual({ automation: { auto_deactivate_days: 0 } });
  });

  it('refuses to build a patch for an unavailable row', () => {
    const row = find(source(), 'channel_sms');

    expect(buildWorkflowPatch(row, true)).toBeNull();
  });
});
