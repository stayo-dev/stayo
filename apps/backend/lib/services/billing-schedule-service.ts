import { computeDueDate } from "@/lib/services/billing-validation";

export type PaymentFrequency =
  | "MONTHLY"
  | "QUARTERLY"
  | "HALF_YEARLY"
  | "ACADEMIC_YEARLY"
  | "CUSTOM_INSTALLMENTS";

export type BillingTransitionStrategy = "NEXT_BILLING_PERIOD" | "NEXT_ACADEMIC_CYCLE";

export type BillingFrequencyPolicy = {
  allowed_frequencies: PaymentFrequency[];
  academic_year_start_month: number;
  academic_year_start_day: number;
  academic_year_name_format: string;
  frequency_change_cooldown_days: number;
  minimum_commitment_months: Record<string, number>;
};

export type BillingInstallment = {
  frequency: PaymentFrequency;
  period_start: Date;
  period_end: Date;
  due_date: Date;
  installment_label: string;
  installment_sequence: number;
  period_months: number;
  amount: number;
  maintenance_amount: number;
};

const DEFAULT_POLICY: BillingFrequencyPolicy = {
  allowed_frequencies: ["MONTHLY", "QUARTERLY"],
  academic_year_start_month: 6,
  academic_year_start_day: 1,
  academic_year_name_format: "YYYY-YYYY",
  frequency_change_cooldown_days: 90,
  minimum_commitment_months: {
    MONTHLY: 1,
    QUARTERLY: 3,
    HALF_YEARLY: 6,
    ACADEMIC_YEARLY: 12,
    CUSTOM_INSTALLMENTS: 1,
  },
};

function asDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function clampDay(year: number, monthIndex: number, day: number) {
  const max = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(Math.max(day, 1), max);
}

function toPositiveInt(value: unknown, fallback: number, max = 366) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

export class BillingScheduleService {
  normalizePolicy(raw?: any): BillingFrequencyPolicy {
    const settings = raw?.billing?.payment_frequency ?? raw?.payment_frequency ?? raw ?? {};
    const allowed = Array.isArray(settings.allowed_frequencies)
      ? settings.allowed_frequencies.filter((f: string) => this.isSupportedFrequency(f))
      : DEFAULT_POLICY.allowed_frequencies;

    return {
      allowed_frequencies: allowed.length ? allowed : DEFAULT_POLICY.allowed_frequencies,
      academic_year_start_month: toPositiveInt(
        settings.academic_year_start_month,
        DEFAULT_POLICY.academic_year_start_month,
        12
      ),
      academic_year_start_day: toPositiveInt(
        settings.academic_year_start_day,
        DEFAULT_POLICY.academic_year_start_day,
        31
      ),
      academic_year_name_format:
        typeof settings.academic_year_name_format === "string" && settings.academic_year_name_format.trim()
          ? settings.academic_year_name_format.trim()
          : DEFAULT_POLICY.academic_year_name_format,
      frequency_change_cooldown_days: toPositiveInt(
        settings.frequency_change_cooldown_days,
        DEFAULT_POLICY.frequency_change_cooldown_days,
        3650
      ),
      minimum_commitment_months: {
        ...DEFAULT_POLICY.minimum_commitment_months,
        ...(settings.minimum_commitment_months && typeof settings.minimum_commitment_months === "object"
          ? settings.minimum_commitment_months
          : {}),
      },
    };
  }

  isSupportedFrequency(frequency: string): frequency is PaymentFrequency {
    return ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ACADEMIC_YEARLY", "CUSTOM_INSTALLMENTS"].includes(frequency);
  }

  exposedFrequencies(): PaymentFrequency[] {
    return ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ACADEMIC_YEARLY"];
  }

  periodMonths(frequency: PaymentFrequency): number {
    if (frequency === "QUARTERLY") return 3;
    if (frequency === "HALF_YEARLY") return 6;
    if (frequency === "ACADEMIC_YEARLY") return 12;
    return 1;
  }

  getPeriodForAnchor(anchor: Date, frequency: PaymentFrequency, policyInput?: any) {
    const policy = this.normalizePolicy(policyInput);
    const monthStart = startOfUtcMonth(anchor);
    const month = monthStart.getUTCMonth();

    if (frequency === "ACADEMIC_YEARLY") {
      const startMonth = policy.academic_year_start_month - 1;
      const startDay = policy.academic_year_start_day;
      const anchorYear = monthStart.getUTCFullYear();
      const candidateDay = clampDay(anchorYear, startMonth, startDay);
      let start = new Date(Date.UTC(anchorYear, startMonth, candidateDay));
      if (asDateOnly(anchor) < start) {
        const previousYear = anchorYear - 1;
        start = new Date(Date.UTC(previousYear, startMonth, clampDay(previousYear, startMonth, startDay)));
      }
      const endBase = addUtcMonths(start, 12);
      const end = new Date(Date.UTC(endBase.getUTCFullYear(), endBase.getUTCMonth(), endBase.getUTCDate() - 1));
      return { start, end };
    }

    const periodLength = this.periodMonths(frequency);
    const startMonth = Math.floor(month / periodLength) * periodLength;
    const start = new Date(Date.UTC(monthStart.getUTCFullYear(), startMonth, 1));
    const end = endOfUtcMonth(addUtcMonths(start, periodLength - 1));
    return { start, end };
  }

  isPeriodStart(anchor: Date, frequency: PaymentFrequency, policyInput?: any) {
    const period = this.getPeriodForAnchor(anchor, frequency, policyInput);
    const key = startOfUtcMonth(anchor);
    return period.start.getUTCFullYear() === key.getUTCFullYear()
      && period.start.getUTCMonth() === key.getUTCMonth()
      && period.start.getUTCDate() === key.getUTCDate();
  }

  getNextCleanBillingPeriodDate(now: Date, frequency: PaymentFrequency, policyInput?: any) {
    const policy = this.normalizePolicy(policyInput);
    let cursor = startOfUtcMonth(addUtcMonths(now, 1));
    for (let i = 0; i < 36; i++) {
      if (this.isPeriodStart(cursor, frequency, policy)) return cursor;
      cursor = startOfUtcMonth(addUtcMonths(cursor, 1));
    }
    return cursor;
  }

  buildInstallment(params: {
    frequency: PaymentFrequency;
    anchorDate: Date;
    monthlyRent: number;
    maintenanceAmount?: number;
    dueDay?: number;
    autoRentDay?: number;
    policy?: any;
  }): BillingInstallment {
    const policy = this.normalizePolicy(params.policy);
    const period = this.getPeriodForAnchor(params.anchorDate, params.frequency, policy);
    const months = this.periodMonths(params.frequency);
    const dueDate = computeDueDate(period.start, Number(params.autoRentDay ?? 1), Number(params.dueDay ?? 5));
    const rent = Math.max(Number(params.monthlyRent) || 0, 0);
    const maintenance = Math.max(Number(params.maintenanceAmount) || 0, 0);
    return {
      frequency: params.frequency,
      period_start: period.start,
      period_end: period.end,
      due_date: dueDate,
      installment_label: this.installmentLabel(params.frequency, period.start, policy),
      installment_sequence: this.installmentSequence(params.frequency, period.start, policy),
      period_months: months,
      amount: Math.round(rent * months * 100) / 100,
      maintenance_amount: Math.round(maintenance * months * 100) / 100,
    };
  }

  previewSchedule(params: {
    frequency: PaymentFrequency;
    startDate: Date;
    monthlyRent: number;
    maintenanceAmount?: number;
    dueDay?: number;
    autoRentDay?: number;
    periods?: number;
    policy?: any;
  }) {
    const periods = Math.max(Number(params.periods ?? 4), 1);
    const items: BillingInstallment[] = [];
    let cursor = this.getPeriodForAnchor(params.startDate, params.frequency, params.policy).start;
    for (let i = 0; i < periods; i++) {
      items.push(this.buildInstallment({ ...params, anchorDate: cursor }));
      cursor = addUtcMonths(cursor, this.periodMonths(params.frequency));
    }
    return items;
  }

  installmentLabel(frequency: PaymentFrequency, periodStart: Date, policy: BillingFrequencyPolicy) {
    const year = periodStart.getUTCFullYear();
    const month = periodStart.getUTCMonth();
    if (frequency === "MONTHLY") {
      return periodStart.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
    }
    if (frequency === "QUARTERLY") return `Quarter ${Math.floor(month / 3) + 1}`;
    if (frequency === "HALF_YEARLY") return month < 6 ? "Half 1" : "Half 2";
    if (frequency === "ACADEMIC_YEARLY") {
      const startMonth = policy.academic_year_start_month - 1;
      const startYear = month >= startMonth ? year : year - 1;
      return `Academic Year ${startYear}-${startYear + 1}`;
    }
    return "Custom installment";
  }

  installmentSequence(frequency: PaymentFrequency, periodStart: Date, policy: BillingFrequencyPolicy) {
    const month = periodStart.getUTCMonth();
    if (frequency === "QUARTERLY") return Math.floor(month / 3) + 1;
    if (frequency === "HALF_YEARLY") return month < 6 ? 1 : 2;
    if (frequency === "ACADEMIC_YEARLY") return 1;
    return month + 1;
  }
}

export const billingScheduleService = new BillingScheduleService();
