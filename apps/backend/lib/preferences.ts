/**
 * 🏗️ Global Preferences Service — SINGLE SOURCE OF TRUTH
 *
 * ALL services MUST use this module to read owner preferences.
 * Direct `(hostel?.preferences_config as any) || {}` is BANNED.
 *
 * This ensures:
 * 1. Type safety — every setting has a defined default
 * 2. Consistency — one place to change defaults
 * 3. Auditability — grep for getPreferences to find every consumer
 */

import { normalizeHostelPolicy, toCompatibilityPreferences } from "./services/hostel-policy-service";

// Re-export context utilities so callers can import from one place
export { getHostelOperationalContext, resolveHostelIdFromTenant, batchGetHostelContexts } from "./hostel-context";

// ─── Strict Typed Preferences ─────────────────────────────────

export interface HostelPreferences {
  // Billing
  rent_cycle: string;
  auto_rent_day: number;
  due_day: number;
  grace_days: number;
  late_fee_type: string;
  late_fee_amount: number;
  late_fee_percentage: number;
  late_fee_after_days: number;
  max_late_fee: number;
  late_fee_rules: any[];

  // Payments
  allow_partial_payments: boolean;
  min_payment_amount: number;
  /** Percentage (0-100) floor on a partial payment. 0 = no percentage floor. */
  min_payment_percentage: number;

  // Advance / Deposit
  advance_enabled: boolean;
  advance_amount_default: number;
  advance_refundable: boolean;

  // Maintenance
  maintenance_enabled: boolean;
  maintenance_amount_default: number;
  maintenance_type: string;  // "MONTHLY" | "ONE_TIME"
  billing_defaults?: {
    advance_deposit: number;
    maintenance_charge: number;
    maintenance_type: string;
    auto_fill_room_rent: boolean;
    allow_override: boolean;
  };

  // Notifications
  reminder_email: boolean;
  reminder_in_app: boolean;
  reminder_whatsapp: boolean;
  reminder_day_1: boolean;
  reminder_day_5: boolean;
  reminder_day_10: boolean;
  reminder_before_due_days?: number[];
  reminder_after_due_days?: number[];
  reminder_auto_stop_after_payment?: boolean;
  reminder_escalation_tone?: string;
  late_fee_notification: boolean;
  owner_daily_summary: boolean;

  // Automation
  auto_generate_rent: boolean;
  auto_apply_late_fees: boolean;
  auto_send_reminders: boolean;
  auto_deactivate_days: number;

  // Receipts
  receipt_prefix: string;
  receipt_format: string;
  auto_email_receipt: boolean;
  receipt_footer: string;

  // Security
  allow_tenant_edits: boolean;
  require_profile_photo_onboarding: boolean;
  data_retention_months: number;

  // System / Localization
  currency: string;
  timezone: string;
  date_format: string;
  time_format: string;
  language: string;
}

const DEFAULTS: HostelPreferences = {
  rent_cycle: "MONTHLY",
  auto_rent_day: 1,
  due_day: 5,
  grace_days: 0,
  late_fee_type: "none",
  late_fee_amount: 200,
  late_fee_percentage: 5,
  late_fee_after_days: 7,
  max_late_fee: 500,
  late_fee_rules: [],

  allow_partial_payments: false,
  min_payment_amount: 0,
  min_payment_percentage: 0,

  advance_enabled: false,
  advance_amount_default: 0,
  advance_refundable: true,

  maintenance_enabled: false,
  maintenance_amount_default: 0,
  maintenance_type: "MONTHLY",

  reminder_email: true,
  reminder_in_app: true,
  reminder_whatsapp: false,
  reminder_day_1: true,
  reminder_day_5: true,
  reminder_day_10: true,
  late_fee_notification: true,
  owner_daily_summary: false,

  auto_generate_rent: true,
  auto_apply_late_fees: true,
  auto_send_reminders: true,
  auto_deactivate_days: 0,

  receipt_prefix: "HMS",
  receipt_format: "PREFIX-YEAR-SEQ",
  auto_email_receipt: false,
  receipt_footer: "",

  allow_tenant_edits: true,
  require_profile_photo_onboarding: false,
  data_retention_months: 0,

  currency: "INR",
  timezone: "Asia/Kolkata",
  date_format: "DD/MM/YYYY",
  time_format: "12h",
  language: "en",
};

// ─── Core API ─────────────────────────────────────────────────

/**
 * Resolve preferences from a hostel record already in memory.
 * Use this in batch operations where you've already fetched hostels.
 */
export function resolvePreferences(hostel: any): HostelPreferences {
  return {
    ...DEFAULTS,
    ...toCompatibilityPreferences(normalizeHostelPolicy(hostel)),
  } as HostelPreferences;
}
