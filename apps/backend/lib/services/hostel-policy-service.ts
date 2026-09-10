import { prisma } from "../db";
import { eventLog } from "./event-log-service";
import { eventSystem } from "../events";
import { applyDueDayChangeInTx } from "@/src/services/payments/due-day-change-service";

export type MaintenanceType = "MONTHLY" | "ONE_TIME" | "NONE";
export type RentCycle = "MONTHLY";
export type PaymentFrequencySetting = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ACADEMIC_YEARLY" | "CUSTOM_INSTALLMENTS";

export type HostelPolicy = {
  policy_version: number;
  schema_version: string;
  billing: {
    rent_cycle: RentCycle;
    auto_rent_day: number;
    due_day: number;
    grace_days: number;
    late_fee: {
      enabled: boolean;
      rules: any[];
      max_amount: number;
    };
    deposit: {
      enabled: boolean;
      default_amount: number;
      refundable: boolean;
      calculation_mode: 'FLAT' | 'MONTHS_OF_RENT';
      deposit_months: number;
    };
    maintenance: {
      type: MaintenanceType;
      amount: number;
    };
    invite_defaults: {
      auto_fill_room_rent: boolean;
      allow_override: boolean;
      agreement_duration_months: number;
    };
    partial_payments: {
      enabled: boolean;
      /** Absolute floor in rupees. 0 = no absolute floor. */
      minimum_amount: number;
      /**
       * Floor as a percentage (0-100) of the tenant's total outstanding.
       * 0 = no percentage floor. When both this and `minimum_amount` are set,
       * the effective minimum is the **larger** of the two — each is a floor,
       * so the stricter one wins. See ADR-043.
       */
      minimum_percentage: number;
    };
    advance_adjustments: {
      enabled: boolean;
    };
    overflow: {
      enabled: boolean;
      strategy: string;
    };
    payment_frequency: {
      allowed_frequencies: PaymentFrequencySetting[];
      academic_year_start_month: number;
      academic_year_start_day: number;
      academic_year_name_format: string;
      frequency_change_cooldown_days: number;
      minimum_commitment_months: Record<string, number>;
    };
  };
  payments: {
    upi_id: string | null;
    phonepe_merchant_id: string | null;
    payment_instructions: string | null;
  };
  reminders: {
    enabled: boolean;
    channels: {
      email: boolean;
      in_app: boolean;
      whatsapp: boolean;
      sms: boolean;
    };
    schedule: {
      before_due_days: number[];
      after_due_days: number[];
    };
    escalation: {
      enabled: boolean;
      after_days: number[];
      tone: string;
    };
    auto_stop_after_payment: boolean;
    late_fee_notifications: boolean;
    owner_daily_summary: boolean;
    strategy: string;
    repeat_interval: number;
    custom_before_due_days: number[];
    custom_after_due_days: number[];
    stop_condition: string;
  };
  receipts: {
    prefix: string;
    format: string;
    auto_email: boolean;
    footer: string;
    invoice_notes: string | null;
    legal_disclaimer: string | null;
  };
  branding: {
    logo_url: string | null;
    primary_color: string | null;
    accent_color: string | null;
    support_contact: string | null;
    legal_name: string | null;
    gst_number: string | null;
  };
  tenant_rules: {
    allow_profile_edits: boolean;
    profile_photo_required: boolean;
    emergency_contact_required: boolean;
    required_profile_fields: string[];
    invite_expiry_hours: number;
    tenant_segment: string;
    /**
     * Whether a tenant must accept and sign the residency agreement before
     * their account is activated. Defaults to true — the pre-existing
     * behaviour, and the one that leaves a signed record.
     *
     * Turning it off skips the RULES and AGREEMENT onboarding steps
     * (`activation-workflow-service.assertTransition`). It does **not** stop
     * `Agreement` rows being created: that record is the financial contract
     * rent changes, obligations and renewals are keyed to. See ADR-059.
     */
    agreement_required: boolean;
  };

  room_rules: {
    capacity_enforcement: string;
    allow_overbooking: boolean;
    transfer_policy: string;
    allocation_requires_room_rent: boolean;
  };
  automation: {
    auto_generate_rent: boolean;
    auto_apply_late_fees: boolean;
    auto_send_reminders: boolean;
    auto_email_receipts: boolean;
    auto_deactivate_days: number;
    nightly_reconciliation: boolean;
    snapshot_generation: boolean;
  };
  dashboard: {
    default_view: string;
    enabled_widgets: string[];
    show_risk_alerts: boolean;
    show_collection_forecast: boolean;
    highlight_overdue: boolean;
    occupancy_warning_threshold: number;
    collection_target_percentage: number;
  };
  notifications: {
    owner_daily_summary: boolean;
    channels: {
      email: boolean;
      in_app: boolean;
      whatsapp: boolean;
      sms: boolean;
    };
  };
  operations: {
    currency: string;
    timezone: string;
    date_format: string;
    time_format: string;
    language: string;
    data_retention_months: number;
  };
};

export type HostelPolicyResponse = {
  hostel: {
    id: string;
    owner_id: string;
    name: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    upi_id: string | null;
    gst_number: string | null;
    logo_url: string | null;
    /**
     * Who the hostel takes. Read back here because this is the endpoint the
     * Hostel identity form loads from — `PATCH /hostels/:id` was already
     * persisting it, but the form's own refetch came back without the field,
     * reset the selector to "Not set", and made a successful save look like a
     * failed one.
     */
    hostel_type: string | null;
  };
  policy: HostelPolicy;
  compatibility_preferences: Record<string, any>;
};

const SCHEMA_VERSION = "2026-05-09";
const VALID_DOMAINS = new Set([
  "billing",
  "payments",
  "reminders",
  "receipts",
  "branding",
  "tenant_rules",

  "room_rules",
  "automation",
  "dashboard",
  "notifications",
  "operations",
]);

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function bool(value: unknown, fallback: boolean) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function num(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number, label: string) {
  const parsed = num(value, fallback);
  if (parsed < min || parsed > max) throw new Error(`VALIDATION: ${label} must be ${min}-${max}`);
  return parsed;
}

function compatibleNumber(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value: unknown, fallback: number, label: string, max = Number.MAX_SAFE_INTEGER) {
  const parsed = num(value, fallback);
  if (parsed < 0 || parsed > max) throw new Error(`VALIDATION: ${label} must be a non-negative number`);
  return parsed;
}

function maintenanceType(value: unknown): MaintenanceType {
  const normalized = String(value || "MONTHLY").toUpperCase();
  if (!["MONTHLY", "ONE_TIME", "NONE"].includes(normalized)) {
    throw new Error("VALIDATION: Invalid maintenance type");
  }
  return normalized as MaintenanceType;
}

function depositCalculationMode(value: unknown): "FLAT" | "MONTHS_OF_RENT" {
  const raw = value === undefined || value === null ? "FLAT" : String(value);
  const normalized = raw.toUpperCase();
  if (normalized !== "FLAT" && normalized !== "MONTHS_OF_RENT") {
    throw new Error("VALIDATION: calculation_mode must be FLAT or MONTHS_OF_RENT");
  }
  return normalized as "FLAT" | "MONTHS_OF_RENT";
}

function rentCycle(value: unknown): RentCycle {
  const normalized = String(value || "MONTHLY").toUpperCase();
  return normalized as RentCycle;
}

function paymentFrequencies(value: unknown): PaymentFrequencySetting[] {
  const allowed = new Set(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ACADEMIC_YEARLY", "CUSTOM_INSTALLMENTS"]);
  const values = asArray(value).map((item) => String(item).toUpperCase()).filter((item) => allowed.has(item));
  return (values.length ? values : ["MONTHLY", "QUARTERLY"]) as PaymentFrequencySetting[];
}

function intArray(value: unknown, label: string) {
  const values = asArray(value).map((item) => Number(item));
  if (values.some((item) => !Number.isInteger(item) || item < -30 || item > 90)) {
    throw new Error(`VALIDATION: ${label} must contain safe integer day offsets`);
  }
  return values;
}

function stringArray(value: unknown) {
  return asArray(value).filter((item) => typeof item === "string");
}

function legacyReminderDays(config: Record<string, any>) {
  const days: number[] = [];
  if (config.reminder_day_1 !== false) days.push(1);
  if (config.reminder_day_5 !== false) days.push(5);
  if (config.reminder_day_10 !== false) days.push(10);
  return days;
}

export function normalizeHostelPolicy(hostel: any): HostelPolicy {
  const config = asObject(hostel?.preferences_config);
  const billing = asObject(config.billing);
  const lateFee = asObject(billing.late_fee);
  const deposit = asObject(billing.deposit);
  const maintenance = asObject(billing.maintenance);
  const inviteDefaults = asObject(billing.invite_defaults);
  const partialPayments = asObject(billing.partial_payments);
  const paymentFrequency = asObject(billing.payment_frequency ?? config.payment_frequency);
  const billingDefaults = asObject(config.billing_defaults);
  const reminders = asObject(config.reminders);
  const reminderChannels = asObject(reminders.channels);
  const reminderSchedule = asObject(reminders.schedule);
  const reminderEscalation = asObject(reminders.escalation);
  const receipts = asObject(config.receipts);
  const branding = asObject(config.branding);
  const tenantRules = asObject(config.tenant_rules);

  const roomRules = asObject(config.room_rules);
  const automation = asObject(config.automation);
  const dashboard = asObject(config.dashboard);
  const notifications = asObject(config.notifications);
  const notificationChannels = asObject(notifications.channels);
  const operations = asObject(config.operations);

  const maintenanceResolved = maintenanceType(maintenance.type ?? billingDefaults.maintenance_type ?? config.maintenance_type);
  const maintenanceAmount = maintenanceResolved === "NONE"
    ? 0
    : nonNegative(maintenance.amount ?? billingDefaults.maintenance_charge ?? config.maintenance_amount_default, 0, "Maintenance amount", 50000);

  const lateFeeRules = asArray(lateFee.rules ?? config.late_fee_rules);
  const lateFeeEnabled = lateFee.enabled ?? (lateFeeRules.length > 0 || (config.late_fee_type && config.late_fee_type !== "none"));

  return {
    policy_version: Math.max(1, Math.floor(num(config.policy_version, 1))),
    schema_version: String(config.schema_version || SCHEMA_VERSION),
    billing: {
      rent_cycle: rentCycle(billing.rent_cycle || config.rent_cycle || hostel?.rent_cycle),
      auto_rent_day: compatibleNumber(billing.auto_rent_day ?? config.auto_rent_day ?? hostel?.auto_rent_day, 1),
      due_day: compatibleNumber(billing.due_day ?? config.due_day, 5),
      grace_days: compatibleNumber(billing.grace_days ?? config.grace_days, 0),
      late_fee: {
        enabled: bool(lateFeeEnabled, false),
        rules: lateFeeRules,
        max_amount: nonNegative(lateFee.max_amount ?? config.max_late_fee, 500, "Maximum late fee", 50000),
      },
      deposit: {
        enabled: bool(deposit.enabled ?? config.advance_enabled, false),
        default_amount: nonNegative(deposit.default_amount ?? billingDefaults.advance_deposit ?? config.advance_amount_default, 0, "Default advance deposit", 1000000),
        refundable: bool(deposit.refundable ?? config.advance_refundable, true),
        calculation_mode: depositCalculationMode(deposit.calculation_mode ?? config.deposit_calculation_mode),
        deposit_months: nonNegative(deposit.deposit_months ?? config.deposit_months ?? 1, 1, "Default deposit months", 12),
      },
      maintenance: {
        type: maintenanceResolved,
        amount: maintenanceAmount,
      },
      invite_defaults: {
        auto_fill_room_rent: bool(inviteDefaults.auto_fill_room_rent ?? billingDefaults.auto_fill_room_rent, true),
        allow_override: bool(inviteDefaults.allow_override ?? billingDefaults.allow_override, true),
        agreement_duration_months: boundedNumber(inviteDefaults.agreement_duration_months ?? billingDefaults.agreement_duration_months ?? config.agreement_duration_months ?? 12, 12, 1, 120, "Default agreement duration"),
      },
      partial_payments: {
        enabled: bool(partialPayments.enabled ?? config.allow_partial_payments, false),
        minimum_amount: nonNegative(partialPayments.minimum_amount ?? config.min_payment_amount, 0, "Minimum payment amount", 1000000),
        minimum_percentage: nonNegative(partialPayments.minimum_percentage ?? config.min_payment_percentage, 0, "Minimum payment percentage", 100),
      },
      advance_adjustments: {
        enabled: bool(asObject(billing.advance_adjustments).enabled, false),
      },
      overflow: {
        enabled: bool(asObject(billing.overflow).enabled, true),
        strategy: String(asObject(billing.overflow).strategy || "CARRY_FORWARD"),
      },
      payment_frequency: {
        allowed_frequencies: paymentFrequencies(paymentFrequency.allowed_frequencies),
        academic_year_start_month: compatibleNumber(paymentFrequency.academic_year_start_month, 6),
        academic_year_start_day: compatibleNumber(paymentFrequency.academic_year_start_day, 1),
        academic_year_name_format: String(paymentFrequency.academic_year_name_format || "YYYY-YYYY"),
        frequency_change_cooldown_days: compatibleNumber(paymentFrequency.frequency_change_cooldown_days, 90),
        minimum_commitment_months: {
          MONTHLY: compatibleNumber(asObject(paymentFrequency.minimum_commitment_months).MONTHLY, 1),
          QUARTERLY: compatibleNumber(asObject(paymentFrequency.minimum_commitment_months).QUARTERLY, 3),
          HALF_YEARLY: compatibleNumber(asObject(paymentFrequency.minimum_commitment_months).HALF_YEARLY, 6),
          ACADEMIC_YEARLY: compatibleNumber(asObject(paymentFrequency.minimum_commitment_months).ACADEMIC_YEARLY, 12),
          CUSTOM_INSTALLMENTS: compatibleNumber(asObject(paymentFrequency.minimum_commitment_months).CUSTOM_INSTALLMENTS, 1),
        },
      },
    },
    payments: {
      upi_id: (asObject(config.payments).upi_id ?? hostel?.upi_id ?? null) || null,
      phonepe_merchant_id: (asObject(config.payments).phonepe_merchant_id ?? hostel?.phonepe_merchant_id ?? null) || null,
      payment_instructions: asObject(config.payments).payment_instructions ?? null,
    },
    reminders: {
      enabled: bool(reminders.enabled ?? config.auto_send_reminders, true),
      channels: {
        email: bool(reminderChannels.email ?? config.reminder_email, true),
        in_app: bool(reminderChannels.in_app ?? config.reminder_in_app, true),
        whatsapp: bool(reminderChannels.whatsapp ?? config.reminder_whatsapp, false),
        sms: bool(reminderChannels.sms, false),
      },
      schedule: {
        before_due_days: intArray(reminderSchedule.before_due_days ?? config.reminder_before_due_days, "Before-due reminder days"),
        after_due_days: intArray(reminderSchedule.after_due_days ?? config.reminder_after_due_days ?? legacyReminderDays(config), "After-due reminder days"),
      },
      escalation: {
        enabled: bool(reminderEscalation.enabled, false),
        after_days: intArray(reminderEscalation.after_days ?? config.reminder_escalation_after_days, "Escalation days"),
        tone: String(reminderEscalation.tone || config.reminder_escalation_tone || "STANDARD"),
      },
      auto_stop_after_payment: bool(reminders.auto_stop_after_payment ?? config.reminder_auto_stop_after_payment, true),
      late_fee_notifications: bool(reminders.late_fee_notifications ?? config.late_fee_notification, true),
      owner_daily_summary: bool(reminders.owner_daily_summary ?? config.owner_daily_summary, false),
      strategy: String(reminders.strategy ?? config.reminder_strategy ?? "custom"),
      repeat_interval: Number(reminders.repeat_interval ?? config.reminder_repeat_interval ?? 0),
      custom_before_due_days: intArray(reminders.custom_before_due_days ?? config.reminder_custom_before_due_days ?? [], "Custom before-due days"),
      custom_after_due_days: intArray(reminders.custom_after_due_days ?? config.reminder_custom_after_due_days ?? [], "Custom after-due days"),
      stop_condition: String(reminders.stop_condition ?? config.reminder_stop_condition ?? (bool(reminders.auto_stop_after_payment ?? config.reminder_auto_stop_after_payment, true) ? "paid" : "never")),
    },
    receipts: {
      prefix: String(receipts.prefix ?? config.receipt_prefix ?? hostel?.receipt_prefix ?? "HMS"),
      format: String(receipts.format ?? config.receipt_format ?? "PREFIX-YEAR-SEQ"),
      auto_email: bool(receipts.auto_email ?? config.auto_email_receipt, false),
      footer: String(receipts.footer ?? config.receipt_footer ?? ""),
      invoice_notes: receipts.invoice_notes ?? null,
      legal_disclaimer: receipts.legal_disclaimer ?? null,
    },
    branding: {
      logo_url: (branding.logo_url ?? hostel?.logo_url ?? null) || null,
      primary_color: branding.primary_color ?? null,
      accent_color: branding.accent_color ?? null,
      support_contact: branding.support_contact ?? null,
      legal_name: branding.legal_name ?? hostel?.name ?? null,
      gst_number: (branding.gst_number ?? hostel?.gst_number ?? null) || null,
    },
    tenant_rules: {
      allow_profile_edits: bool(tenantRules.allow_profile_edits ?? config.allow_tenant_edits, true),
      profile_photo_required: bool(tenantRules.profile_photo_required ?? config.require_profile_photo_onboarding, false),
      emergency_contact_required: bool(tenantRules.emergency_contact_required, false),
      required_profile_fields: stringArray(tenantRules.required_profile_fields),
      invite_expiry_hours: boundedNumber(tenantRules.invite_expiry_hours, 48, 1, 720, "Invite expiry hours"),

      tenant_segment: String(tenantRules.tenant_segment || "MIXED"),
      // Defaults to true so every hostel that predates this field keeps
      // requiring a signed agreement — an absent flag must never silently
      // relax a legal step.
      agreement_required: bool(tenantRules.agreement_required, true),
    },

    room_rules: {
      capacity_enforcement: String(roomRules.capacity_enforcement || "STRICT"),
      allow_overbooking: bool(roomRules.allow_overbooking, false),
      transfer_policy: String(roomRules.transfer_policy || "OWNER_APPROVAL"),
      allocation_requires_room_rent: bool(roomRules.allocation_requires_room_rent, true),
    },
    automation: {
      auto_generate_rent: bool(automation.auto_generate_rent ?? config.auto_generate_rent, true),
      auto_apply_late_fees: bool(automation.auto_apply_late_fees ?? config.auto_apply_late_fees, true),
      auto_send_reminders: bool(automation.auto_send_reminders ?? config.auto_send_reminders, true),
      auto_email_receipts: bool(automation.auto_email_receipts ?? config.auto_email_receipt, false),
      auto_deactivate_days: boundedNumber(automation.auto_deactivate_days ?? config.auto_deactivate_days, 0, 0, 365, "Auto deactivate days"),
      nightly_reconciliation: bool(automation.nightly_reconciliation, true),
      snapshot_generation: bool(automation.snapshot_generation, true),
    },
    dashboard: {
      default_view: String(dashboard.default_view || "OPERATIONS"),
      enabled_widgets: stringArray(dashboard.enabled_widgets),
      show_risk_alerts: bool(dashboard.show_risk_alerts, true),
      show_collection_forecast: bool(dashboard.show_collection_forecast, true),
      highlight_overdue: bool(dashboard.highlight_overdue, true),
      occupancy_warning_threshold: boundedNumber(dashboard.occupancy_warning_threshold, 80, 0, 100, "Occupancy warning threshold"),
      collection_target_percentage: boundedNumber(dashboard.collection_target_percentage, 95, 0, 100, "Collection target percentage"),
    },
    notifications: {
      owner_daily_summary: bool(notifications.owner_daily_summary ?? config.owner_daily_summary, false),
      channels: {
        email: bool(notificationChannels.email ?? config.reminder_email, true),
        in_app: bool(notificationChannels.in_app ?? config.reminder_in_app, true),
        whatsapp: bool(notificationChannels.whatsapp ?? config.reminder_whatsapp, false),
        sms: bool(notificationChannels.sms, false),
      },
    },
    operations: {
      currency: String(operations.currency ?? config.currency ?? hostel?.currency ?? "INR"),
      timezone: String(operations.timezone ?? config.timezone ?? hostel?.timezone ?? "Asia/Kolkata"),
      date_format: String(operations.date_format ?? config.date_format ?? "DD/MM/YYYY"),
      time_format: String(operations.time_format ?? config.time_format ?? "12h"),
      language: String(operations.language ?? config.language ?? "en"),
      data_retention_months: boundedNumber(operations.data_retention_months ?? config.data_retention_months, 0, 0, 120, "Data retention months"),
    },
  };
}

export function toCompatibilityPreferences(policy: HostelPolicy): Record<string, any> {
  return {
    currency: policy.operations.currency,
    timezone: policy.operations.timezone,
    date_format: policy.operations.date_format,
    time_format: policy.operations.time_format,
    language: policy.operations.language,
    data_retention_months: policy.operations.data_retention_months,
    rent_cycle: policy.billing.rent_cycle,
    auto_rent_day: policy.billing.auto_rent_day,
    due_day: policy.billing.due_day,
    grace_days: policy.billing.grace_days,
    late_fee_type: policy.billing.late_fee.rules?.[0]?.type || "none",
    late_fee_amount: policy.billing.late_fee.rules?.[0]?.amount ?? 200,
    late_fee_percentage: policy.billing.late_fee.rules?.[0]?.value ?? 5,
    late_fee_after_days: policy.billing.late_fee.rules?.[0]?.after_days ?? 7,
    late_fee_rules: policy.billing.late_fee.rules,
    max_late_fee: policy.billing.late_fee.max_amount,
    advance_enabled: policy.billing.deposit.enabled,
    advance_amount_default: policy.billing.deposit.default_amount,
    advance_refundable: policy.billing.deposit.refundable,
    deposit_calculation_mode: policy.billing.deposit.calculation_mode,
    deposit_months: policy.billing.deposit.deposit_months,
    maintenance_enabled: policy.billing.maintenance.type !== "NONE",
    maintenance_amount_default: policy.billing.maintenance.amount,
    maintenance_type: policy.billing.maintenance.type,
    billing_defaults: {
      advance_deposit: policy.billing.deposit.default_amount,
      security_deposit: policy.billing.deposit.default_amount,
      deposit_calculation_mode: policy.billing.deposit.calculation_mode,
      deposit_months: policy.billing.deposit.deposit_months,
      maintenance_charge: policy.billing.maintenance.amount,
      maintenance_type: policy.billing.maintenance.type,
      auto_fill_room_rent: policy.billing.invite_defaults.auto_fill_room_rent,
      allow_override: policy.billing.invite_defaults.allow_override,
      agreement_duration_months: policy.billing.invite_defaults.agreement_duration_months,
    },
    allow_partial_payments: policy.billing.partial_payments.enabled,
    min_payment_amount: policy.billing.partial_payments.minimum_amount,
    min_payment_percentage: policy.billing.partial_payments.minimum_percentage,
    allowed_frequencies: policy.billing.payment_frequency.allowed_frequencies,
    academic_year_start_month: policy.billing.payment_frequency.academic_year_start_month,
    academic_year_start_day: policy.billing.payment_frequency.academic_year_start_day,
    academic_year_name_format: policy.billing.payment_frequency.academic_year_name_format,
    frequency_change_cooldown_days: policy.billing.payment_frequency.frequency_change_cooldown_days,
    minimum_commitment_months: policy.billing.payment_frequency.minimum_commitment_months,
    upi_id: policy.payments.upi_id || "",
    phonepe_merchant_id: policy.payments.phonepe_merchant_id || "",
    reminder_email: policy.reminders.channels.email,
    reminder_in_app: policy.reminders.channels.in_app,
    reminder_whatsapp: policy.reminders.channels.whatsapp,
    reminder_day_1: policy.reminders.schedule.after_due_days.includes(1),
    reminder_day_5: policy.reminders.schedule.after_due_days.includes(5),
    reminder_day_10: policy.reminders.schedule.after_due_days.includes(10),
    reminder_before_due_days: policy.reminders.schedule.before_due_days,
    reminder_after_due_days: policy.reminders.schedule.after_due_days,
    reminder_auto_stop_after_payment: policy.reminders.auto_stop_after_payment,
    reminder_escalation_tone: policy.reminders.escalation.tone,
    late_fee_notification: policy.reminders.late_fee_notifications,
    owner_daily_summary: policy.reminders.owner_daily_summary,
    auto_generate_rent: policy.automation.auto_generate_rent,
    auto_apply_late_fees: policy.automation.auto_apply_late_fees,
    auto_send_reminders: policy.automation.auto_send_reminders,
    auto_deactivate_days: policy.automation.auto_deactivate_days,
    receipt_prefix: policy.receipts.prefix,
    receipt_format: policy.receipts.format,
    auto_email_receipt: policy.receipts.auto_email,
    receipt_footer: policy.receipts.footer,

    allow_tenant_edits: policy.tenant_rules.allow_profile_edits,
    require_profile_photo_onboarding: policy.tenant_rules.profile_photo_required,
  };
}

export function compatibilityPreferencesToPolicyPatch(data: Record<string, any>): Record<string, any> {
  const depositPatch: Record<string, any> = {};
  if (data.advance_enabled !== undefined) depositPatch.enabled = data.advance_enabled;
  if (data.advance_amount_default !== undefined) depositPatch.default_amount = data.advance_amount_default;
  if (data.advance_refundable !== undefined) depositPatch.refundable = data.advance_refundable;
  if (data.deposit_calculation_mode !== undefined) depositPatch.calculation_mode = data.deposit_calculation_mode;
  if (data.deposit_months !== undefined) depositPatch.deposit_months = data.deposit_months;

  if (data.billing_defaults !== undefined) {
    const defaultAmount = data.billing_defaults.security_deposit ?? data.billing_defaults.advance_deposit;
    if (defaultAmount !== undefined) {
      depositPatch.default_amount = defaultAmount;
    }
    if (data.billing_defaults.deposit_calculation_mode !== undefined) {
      depositPatch.calculation_mode = data.billing_defaults.deposit_calculation_mode;
    }
    if (data.billing_defaults.deposit_months !== undefined) {
      depositPatch.deposit_months = data.billing_defaults.deposit_months;
    }
  }

  return {
    billing: {
      ...(data.rent_cycle !== undefined && { rent_cycle: data.rent_cycle }),
      ...(data.auto_rent_day !== undefined && { auto_rent_day: data.auto_rent_day }),
      ...(data.due_day !== undefined && { due_day: data.due_day }),
      ...(data.grace_days !== undefined && { grace_days: data.grace_days }),
      ...((data.late_fee_rules !== undefined || data.max_late_fee !== undefined) && {
        late_fee: {
          ...(data.late_fee_rules !== undefined && { rules: data.late_fee_rules }),
          ...(data.max_late_fee !== undefined && { max_amount: data.max_late_fee }),
        },
      }),
      ...(Object.keys(depositPatch).length > 0 && { deposit: depositPatch }),
      ...(data.billing_defaults !== undefined && {
        maintenance: { type: data.billing_defaults.maintenance_type, amount: data.billing_defaults.maintenance_charge },
        invite_defaults: {
          auto_fill_room_rent: data.billing_defaults.auto_fill_room_rent,
          allow_override: data.billing_defaults.allow_override,
          agreement_duration_months: data.billing_defaults.agreement_duration_months,
        },
      }),
      ...((data.allow_partial_payments !== undefined
        || data.min_payment_amount !== undefined
        || data.min_payment_percentage !== undefined) && {
        partial_payments: {
          ...(data.allow_partial_payments !== undefined && { enabled: data.allow_partial_payments }),
          ...(data.min_payment_amount !== undefined && { minimum_amount: data.min_payment_amount }),
          ...(data.min_payment_percentage !== undefined && { minimum_percentage: data.min_payment_percentage }),
        },
      }),
      ...((data.allowed_frequencies !== undefined
        || data.academic_year_start_month !== undefined
        || data.academic_year_start_day !== undefined
        || data.academic_year_name_format !== undefined
        || data.frequency_change_cooldown_days !== undefined
        || data.minimum_commitment_months !== undefined) && {
        payment_frequency: {
          ...(data.allowed_frequencies !== undefined && { allowed_frequencies: data.allowed_frequencies }),
          ...(data.academic_year_start_month !== undefined && { academic_year_start_month: data.academic_year_start_month }),
          ...(data.academic_year_start_day !== undefined && { academic_year_start_day: data.academic_year_start_day }),
          ...(data.academic_year_name_format !== undefined && { academic_year_name_format: data.academic_year_name_format }),
          ...(data.frequency_change_cooldown_days !== undefined && { frequency_change_cooldown_days: data.frequency_change_cooldown_days }),
          ...(data.minimum_commitment_months !== undefined && { minimum_commitment_months: data.minimum_commitment_months }),
        },
      }),
    },
    payments: {
      ...(data.upi_id !== undefined && { upi_id: data.upi_id }),
      ...(data.phonepe_merchant_id !== undefined && { phonepe_merchant_id: data.phonepe_merchant_id }),
    },
    reminders: {
      ...(data.auto_send_reminders !== undefined && { enabled: data.auto_send_reminders }),
      channels: {
        ...(data.reminder_email !== undefined && { email: data.reminder_email }),
        ...(data.reminder_in_app !== undefined && { in_app: data.reminder_in_app }),
        ...(data.reminder_whatsapp !== undefined && { whatsapp: data.reminder_whatsapp }),
      },
      ...((data.reminder_after_due_days !== undefined || data.reminder_before_due_days !== undefined || data.reminder_day_1 !== undefined || data.reminder_day_5 !== undefined || data.reminder_day_10 !== undefined) && {
        schedule: {
          ...(data.reminder_before_due_days !== undefined && { before_due_days: data.reminder_before_due_days }),
          after_due_days: data.reminder_after_due_days !== undefined
            ? data.reminder_after_due_days
            : [
                ...(data.reminder_day_1 !== false ? [1] : []),
                ...(data.reminder_day_5 !== false ? [5] : []),
                ...(data.reminder_day_10 !== false ? [10] : []),
              ],
        },
      }),
      ...((data.reminder_escalation_tone !== undefined || data.reminder_escalation_after_days !== undefined) && {
        escalation: {
          ...(data.reminder_escalation_tone !== undefined && { tone: data.reminder_escalation_tone }),
          ...(data.reminder_escalation_after_days !== undefined && { after_days: data.reminder_escalation_after_days }),
        },
      }),
      ...(data.reminder_auto_stop_after_payment !== undefined && { auto_stop_after_payment: data.reminder_auto_stop_after_payment }),
      ...(data.late_fee_notification !== undefined && { late_fee_notifications: data.late_fee_notification }),
      ...(data.owner_daily_summary !== undefined && { owner_daily_summary: data.owner_daily_summary }),
    },
    automation: {
      ...(data.auto_generate_rent !== undefined && { auto_generate_rent: data.auto_generate_rent }),
      ...(data.auto_apply_late_fees !== undefined && { auto_apply_late_fees: data.auto_apply_late_fees }),
      ...(data.auto_send_reminders !== undefined && { auto_send_reminders: data.auto_send_reminders }),
      ...(data.auto_deactivate_days !== undefined && { auto_deactivate_days: data.auto_deactivate_days }),
      ...(data.auto_email_receipt !== undefined && { auto_email_receipts: data.auto_email_receipt }),
    },
    receipts: {
      ...(data.receipt_prefix !== undefined && { prefix: data.receipt_prefix }),
      ...(data.receipt_format !== undefined && { format: data.receipt_format }),
      ...(data.auto_email_receipt !== undefined && { auto_email: data.auto_email_receipt }),
      ...(data.receipt_footer !== undefined && { footer: data.receipt_footer }),
    },

    tenant_rules: {
      ...(data.allow_tenant_edits !== undefined && { allow_profile_edits: data.allow_tenant_edits }),
      ...(data.require_profile_photo_onboarding !== undefined && { profile_photo_required: data.require_profile_photo_onboarding }),
    },
    operations: {
      ...(data.currency !== undefined && { currency: data.currency }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.date_format !== undefined && { date_format: data.date_format }),
      ...(data.time_format !== undefined && { time_format: data.time_format }),
      ...(data.language !== undefined && { language: data.language }),
      ...(data.data_retention_months !== undefined && { data_retention_months: data.data_retention_months }),
    },
  };
}

function validateAllowedDomains(patch: Record<string, any>) {
  for (const key of Object.keys(patch)) {
    if (!VALID_DOMAINS.has(key)) {
      throw new Error(`VALIDATION: Unsupported policy domain '${key}'`);
    }
  }
}

function deepMerge<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
  const output: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = output[key];
    output[key] = asObject(current) === current && asObject(value) === value
      ? deepMerge(current, value as Record<string, any>)
      : value;
  }
  return output as T;
}

function mergePolicy(current: HostelPolicy, patch: Record<string, any>): HostelPolicy {
  validateAllowedDomains(patch);
  const automationPatch = asObject(patch.automation);
  const receiptsPatch = asObject(patch.receipts);
  const receiptAutoEmail = receiptsPatch.auto_email !== undefined
    ? receiptsPatch.auto_email
    : automationPatch.auto_email_receipts;
  const nextConfig = {
    policy_version: current.policy_version + 1,
    schema_version: SCHEMA_VERSION,
    billing: deepMerge(current.billing, asObject(patch.billing)),
    payments: deepMerge(current.payments, asObject(patch.payments)),
    reminders: deepMerge(current.reminders, asObject(patch.reminders)),
    receipts: deepMerge(current.receipts, {
      ...receiptsPatch,
      ...(receiptAutoEmail !== undefined ? { auto_email: receiptAutoEmail } : {}),
    }),
    branding: deepMerge(current.branding, asObject(patch.branding)),
    tenant_rules: deepMerge(current.tenant_rules, asObject(patch.tenant_rules)),

    room_rules: deepMerge(current.room_rules, asObject(patch.room_rules)),
    automation: deepMerge(current.automation, {
      ...automationPatch,
      ...(receiptAutoEmail !== undefined ? { auto_email_receipts: receiptAutoEmail } : {}),
    }),
    dashboard: deepMerge(current.dashboard, asObject(patch.dashboard)),
    notifications: deepMerge(current.notifications, asObject(patch.notifications)),
    operations: deepMerge(current.operations, asObject(patch.operations)),
  };
  return normalizeHostelPolicy({ preferences_config: nextConfig });
}

function changedDomains(before: HostelPolicy, after: HostelPolicy) {
  return Array.from(VALID_DOMAINS).filter((domain) => JSON.stringify((before as any)[domain]) !== JSON.stringify((after as any)[domain]));
}

export function validateHostelPolicyForWrite(policy: HostelPolicy) {
  if (policy.billing.rent_cycle !== "MONTHLY") throw new Error("VALIDATION: Unsupported rent cycle");
  boundedNumber(policy.billing.auto_rent_day, 1, 1, 28, "Rent generation day");
  boundedNumber(policy.billing.due_day, 5, 1, 28, "Due day");
  boundedNumber(policy.billing.grace_days, 0, 0, 30, "Grace period");
  nonNegative(policy.billing.late_fee.max_amount, 500, "Maximum late fee", 50000);
  nonNegative(policy.billing.deposit.default_amount, 0, "Default advance deposit", 1000000);
  const mode = policy.billing.deposit.calculation_mode;
  if (mode !== "FLAT" && mode !== "MONTHS_OF_RENT") {
    throw new Error("VALIDATION: calculation_mode must be FLAT or MONTHS_OF_RENT");
  }
  boundedNumber(policy.billing.deposit.deposit_months, 1, 1, 12, "Default deposit months");
  nonNegative(policy.billing.maintenance.amount, 0, "Maintenance amount", 50000);
  nonNegative(policy.billing.partial_payments.minimum_amount, 0, "Minimum payment amount", 1000000);
  nonNegative(policy.billing.partial_payments.minimum_percentage, 0, "Minimum payment percentage", 100);
  boundedNumber(policy.billing.payment_frequency.academic_year_start_month, 6, 1, 12, "Academic year start month");
  boundedNumber(policy.billing.payment_frequency.academic_year_start_day, 1, 1, 31, "Academic year start day");
  boundedNumber(policy.billing.payment_frequency.frequency_change_cooldown_days, 90, 0, 3650, "Frequency change cooldown");
  for (const [frequency, months] of Object.entries(policy.billing.payment_frequency.minimum_commitment_months || {})) {
    boundedNumber(months, 1, 0, 120, `${frequency} minimum commitment`);
  }
  boundedNumber(policy.billing.invite_defaults.agreement_duration_months, 12, 1, 120, "Default agreement duration");
  boundedNumber(policy.tenant_rules.invite_expiry_hours, 48, 1, 720, "Invite expiry hours");
  boundedNumber(policy.automation.auto_deactivate_days, 0, 0, 365, "Auto deactivate days");
  boundedNumber(policy.dashboard.occupancy_warning_threshold, 80, 0, 100, "Occupancy warning threshold");
  boundedNumber(policy.dashboard.collection_target_percentage, 95, 0, 100, "Collection target percentage");
  boundedNumber(policy.operations.data_retention_months, 0, 0, 120, "Data retention months");
  intArray(policy.reminders.schedule.before_due_days, "Before-due reminder days");
  intArray(policy.reminders.schedule.after_due_days, "After-due reminder days");
  intArray(policy.reminders.custom_before_due_days, "Custom before-due days");
  intArray(policy.reminders.custom_after_due_days, "Custom after-due days");
  boundedNumber(policy.reminders.repeat_interval, 0, 0, 90, "Repeat interval");
  intArray(policy.reminders.escalation.after_days, "Escalation days");
}

function policyToStorage(policy: HostelPolicy, existingConfig: Record<string, any>) {
  const compatibility = toCompatibilityPreferences(policy);
  return {
    ...existingConfig,
    ...compatibility,
    policy_version: policy.policy_version,
    schema_version: policy.schema_version,
    billing: policy.billing,
    payments: policy.payments,
    reminders: policy.reminders,
    receipts: policy.receipts,
    branding: policy.branding,
    tenant_rules: policy.tenant_rules,

    room_rules: policy.room_rules,
    automation: policy.automation,
    dashboard: policy.dashboard,
    notifications: policy.notifications,
    operations: policy.operations,
  };
}

export class HostelPolicyService {
  async getHostelPolicy(hostelId: string, ownerId?: string): Promise<HostelPolicyResponse> {
    const hostel = await prisma.hostels.findFirst({
      where: {
        id: hostelId,
        status: { in: ["ACTIVE", "INACTIVE", "ARCHIVED"] },
        ...(ownerId ? { owner_id: ownerId } : {}),
      },
      select: {
        id: true,
        owner_id: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        upi_id: true,
        gst_number: true,
        logo_url: true,
        // Selected explicitly, like every other column here — this query
        // deliberately does not take the whole row.
        hostel_type: true,
        currency: true,
        rent_cycle: true,
        receipt_prefix: true,
        timezone: true,
        auto_rent_day: true,
        phonepe_merchant_id: true,
        preferences_config: true,
      },
    });

    if (!hostel) throw new Error(ownerId ? "FORBIDDEN: Hostel is not owned by the authenticated owner" : "NOT_FOUND: Hostel not found");
    const policy = normalizeHostelPolicy(hostel);
    return {
      hostel: {
        id: hostel.id,
        owner_id: hostel.owner_id,
        name: hostel.name,
        phone: hostel.phone,
        address: hostel.address,
        city: hostel.city,
        state: hostel.state,
        pincode: hostel.pincode,
        upi_id: hostel.upi_id,
        gst_number: hostel.gst_number,
        logo_url: hostel.logo_url,
        hostel_type: hostel.hostel_type ?? null,
      },
      policy,
      compatibility_preferences: toCompatibilityPreferences(policy),
    };
  }

  async updateHostelPolicy(hostelId: string, ownerId: string, patch: Record<string, any>, changedBy: string): Promise<HostelPolicyResponse> {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: ownerId },
      select: {
        id: true,
        owner_id: true,
        status: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        upi_id: true,
        gst_number: true,
        logo_url: true,
        // Selected explicitly, like every other column here — this query
        // deliberately does not take the whole row.
        hostel_type: true,
        currency: true,
        rent_cycle: true,
        receipt_prefix: true,
        timezone: true,
        auto_rent_day: true,
        phonepe_merchant_id: true,
        preferences_config: true,
      },
    });
    if (!hostel) throw new Error("FORBIDDEN: Hostel is not owned by the authenticated owner");
    if (hostel.status === "ARCHIVED") {
      throw new Error("FORBIDDEN: Cannot perform operational actions on an archived hostel");
    }
    if (hostel.status === "INACTIVE") {
      throw new Error("FORBIDDEN: Cannot perform operational actions on an inactive hostel");
    }

    const current = normalizeHostelPolicy(hostel);
    const next = mergePolicy(current, patch);
    validateHostelPolicyForWrite(next);
    const existingConfig = asObject(hostel.preferences_config);
    const preferencesConfig = policyToStorage(next, existingConfig);
    const compatibility = toCompatibilityPreferences(next);

    // A due-day change re-dates the hostel's future, unpaid rent/maintenance
    // obligations so recurring rent follows the new day going forward. History
    // (paid / partially-paid rows, past months) is never rewritten. Runs in the
    // same transaction as the policy write so the two can't disagree.
    const dueDayChanged = current.billing.due_day !== next.billing.due_day;
    let dueDayObligationsUpdated = 0;

    await prisma.$transaction(async (tx: any) => {
      await tx.hostels.update({
        where: { id: hostel.id },
        data: {
          currency: next.operations.currency,
          timezone: next.operations.timezone,
          rent_cycle: next.billing.rent_cycle,
          auto_rent_day: next.billing.auto_rent_day,
          receipt_prefix: next.receipts.prefix,
          upi_id: next.payments.upi_id,
          phonepe_merchant_id: next.payments.phonepe_merchant_id,
          gst_number: next.branding.gst_number,
          logo_url: next.branding.logo_url,
          preferences_config: preferencesConfig,
        },
      });

      if (dueDayChanged) {
        const repriced = await applyDueDayChangeInTx(tx, {
          hostelId: hostel.id,
          newDueDay: next.billing.due_day,
          actorId: changedBy,
          reason: "Hostel due-day setting changed",
        });
        dueDayObligationsUpdated = repriced.obligationsUpdated;
      }
    });

    if (dueDayChanged) {
      await eventLog.log("DUE_DAY_CHANGED", ownerId, {
        hostel_id: hostel.id,
        changed_by: changedBy,
        old_due_day: current.billing.due_day,
        new_due_day: next.billing.due_day,
        obligations_updated: dueDayObligationsUpdated,
      }).catch((e: any) => console.error("Failed to log DUE_DAY_CHANGED:", e));
    }

    await eventLog.log("HOSTEL_POLICY_UPDATED", ownerId, {
      hostel_id: hostel.id,
      changed_by: changedBy,
      policy_version: next.policy_version,
      changed_domains: changedDomains(current, next),
    });

    await eventSystem.trigger("hostel_policy_updated", {
      hostel_id: hostel.id,
      owner_id: ownerId,
      userId: changedBy,
      changed_domains: changedDomains(current, next),
      policy_version: next.policy_version,
    }).catch((e: any) => console.error("Failed to trigger hostel_policy_updated event:", e));

    if (JSON.stringify(compatibility.billing_defaults) !== JSON.stringify(toCompatibilityPreferences(current).billing_defaults)) {
      await eventLog.log("BILLING_DEFAULTS_UPDATED", ownerId, {
        hostel_id: hostel.id,
        billing_defaults: compatibility.billing_defaults,
        source: "hostel_policy",
      });
    }

    return this.getHostelPolicy(hostel.id, ownerId);
  }
}

export const hostelPolicyService = new HostelPolicyService();
