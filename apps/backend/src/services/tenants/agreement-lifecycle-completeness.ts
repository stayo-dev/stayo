export const AGREEMENT_LIFECYCLE_INCOMPLETE = "AGREEMENT_LIFECYCLE_INCOMPLETE" as const;

export const REQUIRED_AGREEMENT_LIFECYCLE_FIELDS = [
  "agreement_start_date",
  "agreement_end_date",
  "agreement_duration_months",
  "contract_rent",
  "contract_security_deposit",
  "contract_maintenance",
  "contract_maintenance_type",
  "contract_payment_frequency",
] as const;

type RequiredAgreementLifecycleField = typeof REQUIRED_AGREEMENT_LIFECYCLE_FIELDS[number];

type DateInput = Date | string | number | null | undefined;

type OnboardingLifecycleInput = {
  joiningDate?: DateInput;
  billingStartDate?: DateInput;
  monthlyRent?: unknown;
  roomBaseRent?: unknown;
  advanceDeposit?: unknown;
  maintenanceCharge?: unknown;
  maintenanceType?: unknown;
  paymentFrequency?: unknown;
  durationMonths?: unknown;
};

export type RenewalLifecycleInput = {
  agreement_start_date?: DateInput;
  agreement_end_date?: DateInput;
  agreement_duration_months?: unknown;
};

export class AgreementLifecycleCompletenessError extends Error {
  code = AGREEMENT_LIFECYCLE_INCOMPLETE;
  status = 409;
  details: {
    agreementId?: string;
    missingFields: RequiredAgreementLifecycleField[];
  };

  constructor(message: string, details: { agreementId?: string; missingFields: RequiredAgreementLifecycleField[] }) {
    super(message);
    this.name = "AgreementLifecycleCompletenessError";
    this.details = details;
  }
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toPositiveIntegerOrNull(value: unknown) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return null;
  const integer = Math.trunc(numeric);
  return integer > 0 ? integer : null;
}

function toNonEmptyStringOrNull(value: unknown) {
  const stringValue = String(value ?? "").trim();
  return stringValue || null;
}

export function toAgreementDate(value: DateInput) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addAgreementMonths(startDate: Date, months: number) {
  const date = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

export function buildOnboardingAgreementLifecycle(input: OnboardingLifecycleInput) {
  const startDate = toAgreementDate(input.joiningDate) || toAgreementDate(input.billingStartDate) || toAgreementDate(new Date())!;
  const durationMonths = toPositiveIntegerOrNull(input.durationMonths) || 12;
  const endDate = addAgreementMonths(startDate, durationMonths);
  const contractRent = toNumberOrNull(input.monthlyRent) ?? toNumberOrNull(input.roomBaseRent);
  const contractDeposit = toNumberOrNull(input.advanceDeposit);
  const contractMaintenance = toNumberOrNull(input.maintenanceCharge) ?? 0;
  const contractMaintenanceType = toNonEmptyStringOrNull(input.maintenanceType) || "MONTHLY";
  const contractPaymentFrequency = toNonEmptyStringOrNull(input.paymentFrequency) || "MONTHLY";

  return {
    agreement_start_date: startDate,
    agreement_end_date: endDate,
    agreement_duration_months: durationMonths,
    contract_rent: contractRent,
    contract_security_deposit: contractDeposit,
    contract_maintenance: contractMaintenance,
    contract_maintenance_type: contractMaintenanceType,
    contract_payment_frequency: contractPaymentFrequency,
  };
}

export function buildRenewalAgreementLifecycle(input: RenewalLifecycleInput) {
  return {
    agreement_start_date: toAgreementDate(input.agreement_start_date),
    agreement_end_date: toAgreementDate(input.agreement_end_date),
    agreement_duration_months: toPositiveIntegerOrNull(input.agreement_duration_months),
  };
}

function hasValidValue(agreement: Record<string, any>, field: RequiredAgreementLifecycleField) {
  const value = agreement[field];
  if (field === "agreement_start_date" || field === "agreement_end_date") {
    return Boolean(toAgreementDate(value));
  }
  if (field === "agreement_duration_months") {
    return Boolean(toPositiveIntegerOrNull(value));
  }
  if (field === "contract_maintenance_type" || field === "contract_payment_frequency") {
    return Boolean(toNonEmptyStringOrNull(value));
  }
  return toNumberOrNull(value) !== null;
}

export function getMissingAgreementLifecycleFields(agreement: Record<string, any>) {
  return REQUIRED_AGREEMENT_LIFECYCLE_FIELDS.filter((field) => !hasValidValue(agreement, field));
}

export function assertAgreementLifecycleComplete(
  agreement: Record<string, any>,
  options: { agreementId?: string } = {}
) {
  const missingFields = getMissingAgreementLifecycleFields(agreement);
  if (missingFields.length === 0) return;

  throw new AgreementLifecycleCompletenessError("Agreement lifecycle metadata is incomplete", {
    agreementId: options.agreementId || agreement.id,
    missingFields,
  });
}
