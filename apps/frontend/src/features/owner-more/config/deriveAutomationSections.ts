import { UNAVAILABLE_LABEL, type ConfigRowState } from './configRows';

/**
 * The Automation screen: work that runs without the owner.
 *
 * Unlike Hostel and Finance, these rows *write* — each is a live toggle over
 * `policy.automation` or `policy.notifications.channels`, and those flags gate
 * real cron jobs under `app/api/cron/`. So this module owns two decisions, both
 * tested: what a row shows, and the exact PATCH body a toggle produces.
 *
 * Grouped by what each does for the owner rather than by which system runs it,
 * which is the one place the supplied design improves on the data model.
 */
export interface AutomationSource {
  automation?: {
    auto_generate_rent?: boolean;
    auto_apply_late_fees?: boolean;
    auto_send_reminders?: boolean;
    auto_email_receipts?: boolean;
    /** 0 = escalation off. The backend validates 0–365. */
    auto_deactivate_days?: number;
    nightly_reconciliation?: boolean;
    snapshot_generation?: boolean;
  } | null;
  channels?: { email?: boolean; in_app?: boolean; whatsapp?: boolean; sms?: boolean } | null;
}

export interface ConfigWorkflowRow {
  key: string;
  title: string;
  detail: string;
  /** `null` means unavailable — no toggle is rendered and no patch can be built. */
  enabled: boolean | null;
  state: ConfigRowState;
  /** Dotted policy path this row writes, e.g. `automation.auto_generate_rent`. */
  path?: string;
  /** Values written when switched on/off. Numeric for day-count fields. */
  onValue?: boolean | number;
  offValue?: boolean | number;
}

export interface ConfigWorkflowSection {
  label: string;
  rows: ConfigWorkflowRow[];
}

/** Days restored when overdue escalation is switched back on. */
const DEFAULT_ESCALATION_DAYS = 10;

const toggleRow = (
  key: string,
  title: string,
  path: string,
  enabled: boolean,
  detail: string,
): ConfigWorkflowRow => ({
  key,
  title,
  detail,
  enabled,
  state: enabled ? 'configured' : 'off',
  path,
  onValue: true,
  offValue: false,
});

const unavailableRow = (key: string, title: string): ConfigWorkflowRow => ({
  key,
  title,
  detail: UNAVAILABLE_LABEL,
  enabled: null,
  state: 'unavailable',
});

export function deriveAutomationSections(source: AutomationSource): ConfigWorkflowSection[] {
  const automation = source.automation ?? {};
  const channels = source.channels ?? {};
  const escalationDays = automation.auto_deactivate_days ?? 0;

  return [
    {
      label: 'Collection automation',
      rows: [
        toggleRow(
          'auto_generate_rent',
          'Rent generation',
          'automation.auto_generate_rent',
          Boolean(automation.auto_generate_rent),
          Boolean(automation.auto_generate_rent) ? 'Runs monthly for every hostel' : 'Paused',
        ),
        toggleRow(
          'auto_apply_late_fees',
          'Late fee processing',
          'automation.auto_apply_late_fees',
          Boolean(automation.auto_apply_late_fees),
          Boolean(automation.auto_apply_late_fees) ? 'Runs daily after the grace period' : 'Paused',
        ),
        toggleRow(
          'auto_send_reminders',
          'Reminder engine',
          'automation.auto_send_reminders',
          Boolean(automation.auto_send_reminders),
          Boolean(automation.auto_send_reminders) ? 'Nudges before & after the due date' : 'Paused',
        ),
        {
          key: 'auto_deactivate_days',
          title: 'Overdue escalation',
          detail: escalationDays > 0 ? `Flags tenants ${escalationDays}+ days late` : 'Paused',
          enabled: escalationDays > 0,
          state: escalationDays > 0 ? 'configured' : 'off',
          path: 'automation.auto_deactivate_days',
          onValue: DEFAULT_ESCALATION_DAYS,
          offValue: 0,
        },
      ],
    },
    {
      label: 'Communication',
      rows: [
        toggleRow(
          'channel_whatsapp',
          'WhatsApp',
          'notifications.channels.whatsapp',
          Boolean(channels.whatsapp),
          Boolean(channels.whatsapp) ? 'Reminders & receipts sent on WhatsApp' : 'Off',
        ),
        toggleRow(
          'channel_email',
          'Email',
          'notifications.channels.email',
          Boolean(channels.email),
          Boolean(channels.email) ? 'Reminders & receipts sent by email' : 'Off',
        ),
        toggleRow(
          'channel_in_app',
          'In-app alerts',
          'notifications.channels.in_app',
          Boolean(channels.in_app),
          Boolean(channels.in_app) ? 'Shown in the tenant & owner apps' : 'Off',
        ),
        // `notifications.channels.sms` is a real stored flag, but no SMS
        // provider exists anywhere in the codebase — no sender, no send call.
        // A toggle persisting a preference that changes nothing observable
        // would be worse than saying so.
        unavailableRow('channel_sms', 'SMS'),
      ],
    },
    {
      label: 'Receipts',
      rows: [
        toggleRow(
          'auto_email_receipts',
          'Auto receipts',
          'automation.auto_email_receipts',
          Boolean(automation.auto_email_receipts),
          Boolean(automation.auto_email_receipts) ? 'Sent on every payment' : 'Paused',
        ),
      ],
    },
    {
      label: 'Background services',
      rows: [
        toggleRow(
          'nightly_reconciliation',
          'Nightly reconciliation',
          'automation.nightly_reconciliation',
          Boolean(automation.nightly_reconciliation),
          Boolean(automation.nightly_reconciliation) ? 'Checks payments against the provider nightly' : 'Paused',
        ),
        toggleRow(
          'snapshot_generation',
          'Daily snapshots',
          'automation.snapshot_generation',
          Boolean(automation.snapshot_generation),
          Boolean(automation.snapshot_generation) ? 'Records daily occupancy & collection' : 'Paused',
        ),
        // Both would need endpoints that do not exist: a cron inventory with
        // next-run times, and an owner-facing activity feed screen.
        unavailableRow('scheduled_jobs', 'Scheduled jobs'),
        unavailableRow('activity_logs', 'Activity logs'),
      ],
    },
  ];
}

/**
 * For the "N of M workflows running" banner. `M` counts only rows an owner can
 * actually run — an unavailable row must never inflate the denominator.
 */
export function countWorkflows(rows: ConfigWorkflowRow[]): { running: number; total: number } {
  const real = rows.filter((row) => row.enabled !== null);
  return { running: real.filter((row) => row.enabled === true).length, total: real.length };
}

/**
 * The PATCH body for flipping one row. Returns `null` for an unavailable row,
 * so an accidental call cannot write anything.
 *
 * Day-count fields write a number, not a boolean — `auto_deactivate_days` is
 * validated server-side as 0–365, so `true` would be rejected.
 */
export function buildWorkflowPatch(
  row: ConfigWorkflowRow,
  next: boolean,
): Record<string, unknown> | null {
  if (row.enabled === null || !row.path) return null;

  const value = next ? (row.onValue ?? true) : (row.offValue ?? false);
  return row.path
    .split('.')
    .reverse()
    .reduce<Record<string, unknown> | unknown>((acc, segment) => ({ [segment]: acc }), value) as Record<
    string,
    unknown
  >;
}
