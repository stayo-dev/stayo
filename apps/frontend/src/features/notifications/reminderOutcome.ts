/**
 * What actually happened when an owner tapped "Send reminder".
 *
 * The button used to toast "Reminder sent" on any HTTP 200. The backend has
 * always returned more than that — a per-channel delivery report and a
 * sentence describing it — and the hook threw all of it away. So a reminder
 * that reached nobody, because WhatsApp was switched off for the hostel or
 * because Meta rejected the template, looked identical to one that landed.
 *
 * That is how rent reminders stayed broken for weeks with an owner watching:
 * the one surface that could have reported the failure was hard-coded to
 * report success. See [[Bugs]] and [[Decisions]] ADR-196.
 *
 * Pure on purpose — the frontend suite is node-only and renders nothing, so
 * the decision lives here and `useSendReminder` stays a thin renderer over it.
 */

export type ReminderChannelReport = {
  attempted?: boolean;
  sent?: boolean;
  skipped?: boolean;
  reason?: string;
  error_code?: string;
};

export type SendReminderResponse = {
  success?: boolean;
  message?: string;
  tenant_name?: string;
  channels?: {
    in_app?: ReminderChannelReport;
    email?: ReminderChannelReport;
    whatsapp?: ReminderChannelReport;
    push?: ReminderChannelReport;
  };
};

export type ReminderOutcome = {
  /** Drives which toast is shown; `warning` means "partly delivered". */
  tone: 'success' | 'warning' | 'error';
  message: string;
  /** True only when every channel the hostel has enabled actually delivered. */
  delivered: boolean;
};

/** Channels that put a message in front of a person. */
const REACHING_CHANNELS = ['whatsapp', 'email', 'in_app'] as const;

/**
 * Reasons that are a deliberate configuration choice rather than a failure.
 * "You turned WhatsApp off" is worth saying once, quietly; it is not an error.
 */
const CONFIGURED_OFF = new Set([
  'WHATSAPP_DISABLED',
  'EMAIL_DISABLED',
  'IN_APP_DISABLED',
  'NO_TENANT_ACCOUNT',
  'TENANT_EMAIL_MISSING',
  'TENANT_PHONE_MISSING',
]);

function readable(reason?: string): string {
  if (!reason) return 'unknown reason';
  return reason.toLowerCase().replace(/_/g, ' ');
}

export function describeReminderOutcome(
  response: SendReminderResponse | undefined | null,
): ReminderOutcome {
  const data = response ?? {};
  const channels = data.channels ?? {};
  const name = data.tenant_name;

  // `apiResponse` spreads the payload over `{ success: true }`, so an explicit
  // `success: false` — "no unpaid obligations" — still arrives as HTTP 200.
  if (data.success === false) {
    return {
      tone: 'error',
      message: data.message || `Nothing to remind ${name || 'this tenant'} about`,
      delivered: false,
    };
  }

  const reports = REACHING_CHANNELS.map((key) => [key, channels[key] ?? {}] as const);
  const anySent = reports.some(([, c]) => c.sent);

  // Attempted and failed — a provider rejection, the case that was invisible.
  const failed = reports.filter(([, c]) => c.attempted && !c.sent);

  if (!anySent) {
    const detail = failed.length
      ? failed.map(([key, c]) => `${key}: ${c.error_code || readable(c.reason)}`).join(', ')
      : reports
          .filter(([, c]) => c.skipped)
          .map(([key, c]) => `${key}: ${readable(c.reason)}`)
          .join(', ');
    return {
      tone: 'error',
      message: detail
        ? `Reminder not delivered — ${detail}`
        : data.message || 'Reminder not delivered',
      delivered: false,
    };
  }

  if (failed.length) {
    const detail = failed
      .map(([key, c]) => `${key} failed (${c.error_code || readable(c.reason)})`)
      .join(', ');
    return { tone: 'warning', message: `Partly sent — ${detail}`, delivered: false };
  }

  // Delivered on every channel that tried. Anything skipped was skipped by
  // configuration, which the owner chose and does not need warning about.
  const offByChoice = reports.filter(
    ([, c]) => c.skipped && c.reason && !CONFIGURED_OFF.has(c.reason),
  );
  if (offByChoice.length) {
    const detail = offByChoice
      .map(([key, c]) => `${key} skipped (${readable(c.reason)})`)
      .join(', ');
    return { tone: 'warning', message: `Reminder sent — ${detail}`, delivered: true };
  }

  return {
    tone: 'success',
    message: data.message || `Reminder sent to ${name || 'tenant'}`,
    delivered: true,
  };
}
