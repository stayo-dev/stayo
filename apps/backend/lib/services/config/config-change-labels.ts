/**
 * Owner-readable phrasing for a configuration change, for the Recent Changes
 * timeline on the Configuration hub.
 *
 * Pure and I/O-free by design: the phrasing is a product decision that can be
 * wrong (including whether a number went up or down), so it is verifiable
 * without a database. See tests/config-change-labels.test.ts.
 *
 * A field this function has no phrasing for degrades to "<Field name> updated".
 * It must never interpolate an unknown value — a new policy field would
 * otherwise dump a JSON blob into an owner's activity feed.
 */
export interface ConfigChange {
  domain: string;
  /** Dotted path within the domain, e.g. `late_fee.amount`. */
  field: string;
  from: unknown;
  to: unknown;
}

const DOMAIN_MODULES: Record<string, string> = {
  billing: "Finance",
  payments: "Finance",
  receipts: "Finance",
  branding: "Hostel",
  tenant_rules: "Hostel",
  room_rules: "Hostel",
  automation: "Automation",
  reminders: "Notifications",
  notifications: "Notifications",
};

/** Which configuration module a policy domain belongs to, for grouping and dot colour. */
export function moduleForDomain(domain: string): string {
  return DOMAIN_MODULES[domain] ?? "Configuration";
}

function ordinalDay(day: number): string {
  const withinHundred = day % 100;
  if (withinHundred >= 11 && withinHundred <= 13) return `${day}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/** "raised"/"lowered" when both sides are numbers, else a neutral "changed". */
function direction(from: unknown, to: unknown): "raised" | "lowered" | "changed" {
  if (typeof from === "number" && typeof to === "number") {
    if (to > from) return "raised";
    if (to < from) return "lowered";
  }
  return "changed";
}

function humanizeField(field: string): string {
  const leaf = field.split(".").pop() ?? field;
  const words = leaf.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const plural = (count: number, singular: string) => `${count} ${count === 1 ? singular : `${singular}s`}`;

type Phrase = (change: ConfigChange) => string | null;

/**
 * Keyed by `domain.field`. Anything absent falls through to the generic
 * "<Field> updated", which is the safe default rather than a gap.
 */
const PHRASES: Record<string, Phrase> = {
  "billing.grace_days": ({ from, to }) =>
    `Grace period ${direction(from, to)} to ${plural(Number(to), "day")}`,
  "billing.auto_rent_day": ({ to }) => `Rent generation moved to the ${ordinalDay(Number(to))}`,
  "billing.due_day": ({ to }) => `Rent due date moved to the ${ordinalDay(Number(to))}`,
  "billing.late_fee.amount": ({ from, to }) => `Late fee ${direction(from, to)} to ₹${Number(to)}`,
  "billing.late_fee.enabled": ({ to }) => `Late fees turned ${to ? "on" : "off"}`,
  "billing.deposit.deposit_months": ({ from, to }) =>
    `Security deposit ${direction(from, to)} to ${plural(Number(to), "month")}`,
  "billing.deposit.refundable": ({ to }) =>
    `Deposit marked ${to ? "refundable" : "non-refundable"}`,
  "billing.deposit.enabled": ({ to }) => `Security deposit turned ${to ? "on" : "off"}`,
  "receipts.auto_email": ({ to }) => `Receipt auto-email turned ${to ? "on" : "off"}`,
  "receipts.prefix": ({ to }) => `Receipt prefix changed to ${String(to).slice(0, 12)}`,
  "receipts.footer": () => "Receipt footer updated",
  "branding.logo_url": ({ to }) => (to ? "Logo updated" : "Logo removed"),
  "branding.primary_color": () => "Brand colour updated",
  "branding.accent_color": () => "Accent colour updated",
  "tenant_rules.invite_expiry_hours": ({ from, to }) =>
    `Invite expiry ${direction(from, to)} to ${plural(Number(to), "hour")}`,
  "automation.auto_generate_rent": ({ to }) => `Rent generation turned ${to ? "on" : "off"}`,
  "automation.auto_apply_late_fees": ({ to }) => `Late fee processing turned ${to ? "on" : "off"}`,
  "automation.auto_send_reminders": ({ to }) => `Reminder engine turned ${to ? "on" : "off"}`,
  "automation.auto_email_receipts": ({ to }) => `Auto receipts turned ${to ? "on" : "off"}`,
  "automation.nightly_reconciliation": ({ to }) => `Nightly reconciliation turned ${to ? "on" : "off"}`,
  "automation.snapshot_generation": ({ to }) => `Daily snapshots turned ${to ? "on" : "off"}`,
  "automation.auto_deactivate_days": ({ to }) =>
    Number(to) > 0 ? `Overdue escalation set to ${plural(Number(to), "day")}` : "Overdue escalation turned off",
  "reminders.channels.whatsapp": ({ to }) => `WhatsApp reminders turned ${to ? "on" : "off"}`,
  "reminders.channels.email": ({ to }) => `Email reminders turned ${to ? "on" : "off"}`,
  "reminders.channels.in_app": ({ to }) => `In-app alerts turned ${to ? "on" : "off"}`,
};

export function describeConfigChange(change: ConfigChange): string {
  const phrase = PHRASES[`${change.domain}.${change.field}`];
  if (phrase) {
    const label = phrase(change);
    if (label) return label;
  }
  return `${humanizeField(change.field)} updated`;
}
