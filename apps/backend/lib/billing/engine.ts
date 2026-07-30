/**
 * 🏦 Billing Calculation Engine — Single Source of Truth
 *
 * This module is THE canonical implementation of all billing math.
 * Both the frontend preview and the backend cron MUST derive from this logic.
 *
 * Rules:
 * 1. PURE FUNCTIONS ONLY — no DB, no side effects
 * 2. All amounts in paisa-safe integers (rounded at boundaries)
 * 3. Rules are CUMULATIVE — all enabled rules stack
 * 4. Grace period subtracts from overdue days before any rule evaluation
 * 5. Max cap is enforced across the TOTAL accumulated late fees
 */

// ─── Types ───────────────────────────────────────────────────────

export interface LateFeeRule {
  id: string;
  type: "flat" | "per_day" | "percentage";
  amount?: number;   // for flat / per_day
  value?: number;    // for percentage
  after_days: number;
  enabled: boolean;
}

export interface BillingConfig {
  auto_rent_day: number;
  due_day: number;
  grace_days: number;
  late_fee_rules: LateFeeRule[];
  max_late_fee: number;  // 0 = no cap
}

export interface FeeBreakdownItem {
  ruleId: string;
  ruleType: string;
  feeAmount: number;
  description: string;
  capped: boolean;
}

export interface CalculationResult {
  rentAmount: number;
  totalLateFee: number;
  totalPayable: number;
  breakdown: FeeBreakdownItem[];
  graceDaysApplied: number;
  effectiveDelay: number;
  capApplied: boolean;
}

// ─── Core Calculation ────────────────────────────────────────────

/**
 * Calculate the total late fee for a given rent, delay, and rule set.
 *
 * This is the SINGLE function that both frontend and backend must agree on.
 * The backend uses it to determine fee amounts before writing obligations.
 * The frontend uses it for the what-if calculator.
 *
 * @param config  - Billing rules configuration
 * @param rentAmount - The base rent (or remaining unpaid amount for partial payment support)
 * @param daysDelayed - Calendar days past the due date
 */
export function calculateLateFees(
  config: BillingConfig,
  rentAmount: number,
  daysDelayed: number
): CalculationResult {
  const graceDays = Math.max(Number(config.grace_days) || 0, 0);
  const maxCap = Math.max(Number(config.max_late_fee) || 0, 0);
  const effectiveDelay = Math.max(daysDelayed - graceDays, 0);

  const enabledRules = (config.late_fee_rules || [])
    .filter(r => r.enabled)
    .sort((a, b) => a.after_days - b.after_days);

  let totalLateFee = 0;
  const breakdown: FeeBreakdownItem[] = [];

  for (const rule of enabledRules) {
    const afterDays = Math.max(Number(rule.after_days) || 0, 0);
    if (effectiveDelay < afterDays) continue;

    let feeAmount = 0;
    let desc = "";

    switch (rule.type) {
      case "flat": {
        feeAmount = Math.max(Number(rule.amount) || 0, 0);
        desc = `Flat fee ${feeAmount} (after ${afterDays}d)`;
        break;
      }
      case "percentage": {
        const pct = Math.max(Number(rule.value) || 0, 0);
        feeAmount = Math.round(rentAmount * pct / 100);
        desc = `${pct}% of ${rentAmount} = ${feeAmount} (after ${afterDays}d)`;
        break;
      }
      case "per_day": {
        const dailyAmount = Math.max(Number(rule.amount) || 0, 0);
        const activeDays = Math.max(effectiveDelay - afterDays, 0);
        feeAmount = dailyAmount * activeDays;
        desc = `${dailyAmount}/day × ${activeDays}d = ${feeAmount} (after ${afterDays}d)`;
        break;
      }
      default:
        continue;
    }

    // Enforce cap
    let capped = false;
    if (maxCap > 0 && totalLateFee + feeAmount > maxCap) {
      feeAmount = Math.max(maxCap - totalLateFee, 0);
      capped = true;
    }

    if (feeAmount > 0) {
      totalLateFee += feeAmount;
      breakdown.push({
        ruleId: rule.id,
        ruleType: rule.type,
        feeAmount,
        description: desc + (capped ? " (capped)" : ""),
        capped,
      });
    }
  }

  return {
    rentAmount,
    totalLateFee,
    totalPayable: rentAmount + totalLateFee,
    breakdown,
    graceDaysApplied: graceDays,
    effectiveDelay,
    capApplied: breakdown.some(b => b.capped),
  };
}

// ─── Rule Resolution ─────────────────────────────────────────────

/**
 * Resolve billing rules from preferences config — handles legacy migration.
 * Both backend services and frontend call this to normalize config shape.
 */
export function resolveRules(config: any): { rules: LateFeeRule[]; graceDays: number; maxCap: number } {
  // New format: late_fee_rules array
  if (Array.isArray(config.late_fee_rules) && config.late_fee_rules.length > 0) {
    return {
      rules: config.late_fee_rules.filter((r: any) => r.enabled !== false),
      graceDays: Number(config.grace_days) || 0,
      maxCap: Number(config.max_late_fee) || 0,
    };
  }

  // Legacy format: single flat fields
  if (config.late_fee_type && config.late_fee_type !== "none") {
    const rule: LateFeeRule = {
      id: "legacy",
      type: config.late_fee_type as any,
      after_days: Number(config.late_fee_after_days) || 7,
      enabled: true,
    };
    if (config.late_fee_type === "flat") {
      rule.amount = Number(config.late_fee_amount) || 200;
    } else if (config.late_fee_type === "percentage") {
      rule.value = Number(config.late_fee_percentage) || 5;
    } else if (config.late_fee_type === "per_day") {
      rule.amount = Number(config.late_fee_amount) || 50;
    }
    return {
      rules: [rule],
      graceDays: Number(config.grace_days) || 0,
      maxCap: Number(config.max_late_fee) || 0,
    };
  }

  return { rules: [], graceDays: 0, maxCap: 0 };
}

/**
 * Calculate the fee for a SINGLE rule on a SINGLE day.
 * Used by the daily cron to determine how much to charge today.
 *
 * For per_day rules: returns the daily amount (one day's worth)
 * For one-time rules: returns the full one-time amount
 */
export function calculateSingleRuleFee(
  rule: LateFeeRule,
  rentAmount: number,
): number {
  switch (rule.type) {
    case "flat":
      return Math.max(Number(rule.amount) || 0, 0);
    case "percentage":
      return Math.round(rentAmount * (Math.max(Number(rule.value) || 0, 0)) / 100);
    case "per_day":
      return Math.max(Number(rule.amount) || 0, 0);
    default:
      return 0;
  }
}
