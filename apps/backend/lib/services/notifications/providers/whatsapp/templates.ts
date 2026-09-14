import { onboardingTemplateName as onboardingTemplateNameValue } from "./onboarding-template-contract";
import {
  RENT_REMINDER_TEMPLATES,
  RentReminderKind,
  rentReminderTemplateLanguage,
  rentReminderTemplateName,
} from "./rent-reminder-template-contract";
import { formatDate, formatMonthYear, formatShortDate } from "@/lib/format";
import type { HostelPreferences } from "@/lib/preferences";

export enum WhatsAppRentReminderTemplate {
  RENT_DUE_REMINDER = "RENT_DUE_REMINDER",
  RENT_DUE_TODAY = "RENT_DUE_TODAY",
  RENT_OVERDUE_REMINDER = "RENT_OVERDUE_REMINDER",
  PAYMENT_RECEIPT = "PAYMENT_RECEIPT",
}

export type RentReminderTemplateVariables = {
  obligationId: string;
  tenantName: string;
  /** Generation 2 puts this in the body — it is the reader's trust anchor. */
  hostelName: string;
  amount: number;
  rentMonth: Date | string;
  dueDate: Date | string;
  daysOverdue: number;
  stillDue?: number;
  paymentStatus?: string;
  prefs?: Partial<HostelPreferences>;
};

/** Maps the local enum onto the contract's kinds. One concept, two spellings. */
const TEMPLATE_KIND: Record<WhatsAppRentReminderTemplate, RentReminderKind> = {
  [WhatsAppRentReminderTemplate.RENT_DUE_REMINDER]: "DUE_SOON",
  [WhatsAppRentReminderTemplate.RENT_DUE_TODAY]: "DUE_TODAY",
  [WhatsAppRentReminderTemplate.RENT_OVERDUE_REMINDER]: "OVERDUE",
  [WhatsAppRentReminderTemplate.PAYMENT_RECEIPT]: "PAYMENT_RECEIPT",
};

/**
 * Body parameter builders, one per template.
 *
 * Each inserts the hostel's name, which is what makes a message about money
 * recognisable rather than suspicious. The order here must match
 * `RENT_REMINDER_TEMPLATES[kind].parameters`, which mirrors the body Meta
 * approved — `whatsapp-rent-template-contract.test.ts` asserts that it does.
 * A vector of the right length in the wrong order is not an API error; it is
 * a message that reads fine and says the wrong thing.
 */
const BODY_PARAMETERS: Record<WhatsAppRentReminderTemplate, (data: RentReminderTemplateVariables) => string[]> = {
  [WhatsAppRentReminderTemplate.RENT_DUE_REMINDER]: (data) => [
    data.tenantName || "Resident",
    data.hostelName || "your hostel",
    String(Math.max(1, Math.abs(Math.round(data.daysOverdue)))),
    formatTemplateAmount(data.amount),
    formatMonthYear(data.rentMonth, data.prefs),
    formatDate(data.dueDate, data.prefs),
  ],
  [WhatsAppRentReminderTemplate.RENT_DUE_TODAY]: (data) => [
    data.tenantName || "Resident",
    formatTemplateAmount(data.amount),
    formatMonthYear(data.rentMonth, data.prefs),
    data.hostelName || "your hostel",
  ],
  [WhatsAppRentReminderTemplate.RENT_OVERDUE_REMINDER]: (data) => [
    data.tenantName || "Resident",
    formatTemplateAmount(data.amount),
    formatMonthYear(data.rentMonth, data.prefs),
    data.hostelName || "your hostel",
    String(Math.max(1, Math.floor(data.daysOverdue))),
  ],
  [WhatsAppRentReminderTemplate.PAYMENT_RECEIPT]: (data) => [
    data.tenantName || "Resident",
    formatTemplateAmount(data.amount),
    typeof data.rentMonth === "string" ? data.rentMonth : formatMonthYear(data.rentMonth, data.prefs),
    data.hostelName || "your hostel",
    data.paymentStatus || ((data.stillDue ?? 0) > 0 ? "Partially Paid" : "Paid"),
    formatTemplateAmount(data.stillDue ?? 0),
  ],
};

function formatTemplateAmount(amount: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "0";

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function renderWhatsAppTemplatePreview(
  template: WhatsAppRentReminderTemplate,
  data: RentReminderTemplateVariables
): string {
  const build = BODY_PARAMETERS[template];
  if (!build) return "";
  const params = build(data);
  let body = RENT_REMINDER_TEMPLATES[TEMPLATE_KIND[template]].body;
  params.forEach((param, index) => {
    body = body.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), param);
  });
  return body;
}

export function selectRentReminderTemplate(daysOverdue: number): WhatsAppRentReminderTemplate {
  if (daysOverdue < 0) return WhatsAppRentReminderTemplate.RENT_DUE_REMINDER;
  if (daysOverdue === 0) return WhatsAppRentReminderTemplate.RENT_DUE_TODAY;
  return WhatsAppRentReminderTemplate.RENT_OVERDUE_REMINDER;
}

export function getMetaTemplateName(template: WhatsAppRentReminderTemplate): string {
  return rentReminderTemplateName(TEMPLATE_KIND[template]);
}

export function getMetaTemplateLanguage(template: WhatsAppRentReminderTemplate): string {
  return rentReminderTemplateLanguage(TEMPLATE_KIND[template]);
}

export function buildRentReminderBodyParameters(data: RentReminderTemplateVariables): string[] {
  const template = selectRentReminderTemplate(data.daysOverdue);
  const kind = TEMPLATE_KIND[template];
  const params = BODY_PARAMETERS[template](data).map((value) => String(value).trim());

  // An empty parameter is a 400 from Meta, and a reminder that never arrives.
  // Fail here, where the obligation id is still in hand to log against.
  if (params.some((value) => !value)) {
    throw new Error(`Invalid WhatsApp template variables for ${template}`);
  }

  // The count Meta will reject on, checked against the name we are about to
  // send under. Cheap, and it turns a silent 132000 into a logged obligation id.
  const declared = RENT_REMINDER_TEMPLATES[kind].parameters.length;
  if (params.length !== declared) {
    throw new Error(
      `WhatsApp template ${rentReminderTemplateName(kind)} expects ${declared} parameters, built ${params.length}`
    );
  }

  return params;
}

// ─── Tenant Onboarding Completed Template ────────────────────

/**
 * Re-exported from the contract module, which owns the name (and ignores the
 * retired `tenant_onboarding_completed_v1`, a template that never existed in
 * this WABA and failed every send).
 */
export { onboardingTemplateName, onboardingTemplateLanguage } from "./onboarding-template-contract";
export const ONBOARDING_COMPLETED_TEMPLATE_NAME = onboardingTemplateNameValue();

export type TenantOnboardingTemplateInput = {
  tenantName: string;
  hostelName: string;
  roomNumber: string;
  joiningDate: Date | string;
  monthlyRent: number;
  rentDueDay: number;
};

/**
 * Pure mapper — builds WhatsApp template body parameters from pre-loaded DB data.
 * No database queries. Caller is responsible for loading tenant/room/hostel.
 *
 * Template variables:
 *   {{1}} → Tenant Name
 *   {{2}} → Hostel Name
 *   {{3}} → Room Number
 *   {{4}} → Joining Date
 *   {{5}} → Monthly Rent
 *   {{6}} → Rent Due Day
 */
export function buildTenantOnboardingTemplatePayload(input: TenantOnboardingTemplateInput): string[] {
  const joiningDate = input.joiningDate
    ? formatDate(input.joiningDate)
    : "N/A";

  const params = [
    input.tenantName || "Resident",
    input.hostelName || "Your Hostel",
    input.roomNumber || "N/A",
    joiningDate,
    formatTemplateAmount(input.monthlyRent),
    String(Math.min(Math.max(Number(input.rentDueDay) || 1, 1), 28)),
  ];

  return params;
}

// ─── Owner Post-Activation Welcome Template ────────────────────

/**
 * Re-exported from the contract module, which owns the name/language and
 * the live-template shape check (1 body param, static button — no
 * placeholder to fill).
 */
export {
  ownerWelcomeTemplateName,
  ownerWelcomeTemplateLanguage,
  buildOwnerWelcomeTemplatePayload,
} from "./owner-welcome-template-contract";
import { ownerWelcomeTemplateName as ownerWelcomeTemplateNameValue } from "./owner-welcome-template-contract";
export const OWNER_WELCOME_TEMPLATE_NAME = ownerWelcomeTemplateNameValue();

// ─── Tenant Account Activated Payment Pending Template ────────

export const PAYMENT_PENDING_TEMPLATE_NAME = "account_activated_payment_pending_v1";

export type TenantPaymentPendingTemplateInput = {
  tenantName: string;
};

/**
 * Pure mapper — builds WhatsApp template body parameters.
 *
 * Template variables:
 *   {{1}} → Tenant Name
 */
export function buildTenantPaymentPendingTemplatePayload(input: TenantPaymentPendingTemplateInput): string[] {
  return [input.tenantName || "Resident"];
}

// ─── Agreement Renewal Templates ──────────────────────────────

export const AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME = "agreement_renewal_reminder_v1";
export const AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME = "agreement_renewal_overdue_v1";
export const OWNER_RENEWAL_ALERT_TEMPLATE_NAME = "owner_renewal_alert_v1";

export type AgreementRenewalReminderInput = {
  tenantName: string;
  expiryDate: Date | string;
  status: string;
};

export function buildAgreementRenewalReminderPayload(input: AgreementRenewalReminderInput): string[] {
  return [
    input.tenantName || "Resident",
    formatShortDate(input.expiryDate),
    input.status || "Expiring Soon",
  ];
}

export type AgreementRenewalOverdueInput = {
  tenantName: string;
  expiredOn: Date | string;
  status: string;
};

export function buildAgreementRenewalOverduePayload(input: AgreementRenewalOverdueInput): string[] {
  return [
    input.tenantName || "Resident",
    formatShortDate(input.expiredOn),
    input.status || "Expired",
  ];
}

export type OwnerRenewalAlertInput = {
  tenantName: string;
  roomNo: string;
  status: string;
  expiryDate: Date | string;
  tenantPhone: string;
};

export function buildOwnerRenewalAlertPayload(input: OwnerRenewalAlertInput): string[] {
  return [
    input.tenantName || "Tenant",
    input.roomNo || "N/A",
    input.status || "Attention Required",
    formatShortDate(input.expiryDate),
    input.tenantPhone || "N/A",
  ];
}

// ─── Stay Renewal Offer Templates ─────────────────────────────

export const RENEWAL_OFFER_SENT_TEMPLATE_NAME = "renewal_offer_sent_v1";
export const RENEWAL_OFFER_DECLINED_TEMPLATE_NAME = "renewal_offer_declined_v1";
export const RENEWAL_OFFER_DISCUSSION_TEMPLATE_NAME = "renewal_offer_discussion_v1";

export type RenewalOfferSentTemplateInput = {
  tenantName: string;
  hostelName: string;
  proposedRent: number;
  expiryDate: Date | string;
};

export function buildRenewalOfferSentPayload(input: RenewalOfferSentTemplateInput): string[] {
  return [
    input.tenantName || "Resident",
    input.hostelName || "Your Hostel",
    formatTemplateAmount(input.proposedRent),
    formatShortDate(input.expiryDate),
  ];
}

export type RenewalOfferDeclinedTemplateInput = {
  tenantName: string;
  roomNo: string;
  reason: string;
};

export function buildRenewalOfferDeclinedPayload(input: RenewalOfferDeclinedTemplateInput): string[] {
  return [
    input.tenantName || "Tenant",
    input.roomNo || "N/A",
    input.reason || "No reason provided",
  ];
}

export type RenewalOfferDiscussionTemplateInput = {
  tenantName: string;
  roomNo: string;
  message: string;
};

export function buildRenewalOfferDiscussionPayload(input: RenewalOfferDiscussionTemplateInput): string[] {
  return [
    input.tenantName || "Tenant",
    input.roomNo || "N/A",
    input.message || "Wants to discuss",
  ];
}
