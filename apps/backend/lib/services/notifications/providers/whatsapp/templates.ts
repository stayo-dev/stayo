import { formatDate, formatMonthYear, formatShortDate } from "@/lib/format";
import type { HostelPreferences } from "@/lib/preferences";

export enum WhatsAppRentReminderTemplate {
  RENT_DUE_REMINDER = "RENT_DUE_REMINDER",
  RENT_DUE_TODAY = "RENT_DUE_TODAY",
  RENT_OVERDUE_REMINDER = "RENT_OVERDUE_REMINDER",
}

export type RentReminderTemplateVariables = {
  obligationId: string;
  tenantName: string;
  hostelName: string;
  amount: number;
  rentMonth: Date | string;
  dueDate: Date | string;
  daysOverdue: number;
  prefs?: Partial<HostelPreferences>;
};

type TemplateDefinition = {
  metaName: string;
  languageCode: string;
  templateBody: string;
  buildParameters: (data: RentReminderTemplateVariables) => string[];
};

function formatTemplateAmount(amount: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "0";

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

const TEMPLATE_REGISTRY: Record<WhatsAppRentReminderTemplate, TemplateDefinition> = {
  [WhatsAppRentReminderTemplate.RENT_DUE_REMINDER]: {
    metaName: "rent_due_reminder_v1",
    languageCode: "en_IN",
    templateBody: "Hello *{{1}}*, your rent of *₹{{3}}* for *{{4}}* is due in *{{2}}* days (on *{{5}}*). Please pay on time to avoid late fees. - HMS",
    buildParameters: (data) => [
      data.tenantName || "Tenant",
      String(Math.abs(data.daysOverdue)),
      formatTemplateAmount(data.amount),
      formatMonthYear(data.rentMonth, data.prefs),
      formatDate(data.dueDate, data.prefs),
    ],
  },
  [WhatsAppRentReminderTemplate.RENT_DUE_TODAY]: {
    metaName: "rent_due_today_v1",
    languageCode: "en",
    templateBody: "Hello *{{1}}*, this is a reminder that your rent of *₹{{2}}* for *{{3}}* is due *TODAY*. Please pay using the app to avoid late fees. - HMS",
    buildParameters: (data) => [
      data.tenantName || "Tenant",
      formatTemplateAmount(data.amount),
      formatMonthYear(data.rentMonth, data.prefs),
    ],
  },
  [WhatsAppRentReminderTemplate.RENT_OVERDUE_REMINDER]: {
    metaName: "rent_overdue_warm_v1",
    languageCode: "en_IN",
    templateBody: "Hello *{{1}}*, your rent of *₹{{2}}* for *{{3}}* was due on *{{4}}* and is now overdue by *{{5}}* days. Please make payment as soon as possible. - HMS",
    buildParameters: (data) => [
      data.tenantName || "Tenant",
      formatTemplateAmount(data.amount),
      formatMonthYear(data.rentMonth, data.prefs),
      formatDate(data.dueDate, data.prefs),
      String(Math.max(1, Math.floor(data.daysOverdue))),
    ],
  },
};

export function renderWhatsAppTemplatePreview(
  template: WhatsAppRentReminderTemplate,
  data: RentReminderTemplateVariables
): string {
  const def = TEMPLATE_REGISTRY[template];
  if (!def) return "";
  const params = def.buildParameters(data);
  let body = def.templateBody;
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
  return TEMPLATE_REGISTRY[template].metaName;
}

export function getMetaTemplateLanguage(template: WhatsAppRentReminderTemplate): string {
  return TEMPLATE_REGISTRY[template].languageCode;
}

export function buildRentReminderBodyParameters(data: RentReminderTemplateVariables): string[] {
  const template = selectRentReminderTemplate(data.daysOverdue);
  const params = TEMPLATE_REGISTRY[template]
    .buildParameters(data)
    .map((value) => String(value).trim());

  if (params.some((value) => !value)) {
    throw new Error(`Invalid WhatsApp template variables for ${template}`);
  }

  return params;
}

// ─── Tenant Onboarding Completed Template ────────────────────

export const ONBOARDING_COMPLETED_TEMPLATE_NAME = "tenant_onboarding_completed_v1";

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
