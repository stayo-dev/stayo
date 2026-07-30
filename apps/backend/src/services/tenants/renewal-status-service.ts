import { renewalDecisionService } from "./renewal-decision-service";

export type RenewalStage =
  | "30_DAY_REMINDER"
  | "15_DAY_REMINDER"
  | "EXPIRY_DAY_ALERT"
  | "7_DAY_OVERDUE"
  | "30_DAY_CRITICAL"
  | "EXPIRED_RENT_OVERDUE";

export class RenewalStatusService {
  determineRenewalStage(agreement: any, now: Date = new Date()): RenewalStage | null {
    if (!agreement?.agreement_end_date) {
      return null;
    }

    const decision = renewalDecisionService.evaluateAgreement(agreement, now);

    if (decision.has_successor) {
      // A successor draft/agreement already exists (offer accepted or manual
      // renewal draft created) — the predecessor no longer needs "please
      // renew" nudges; it's just waiting on the successor's own activation.
      return null;
    }

    const daysUntilExpiry = decision.days_until_expiry; // number or null
    const daysOverdue = decision.days_overdue; // number
    const states = decision.states || [];

    // 1. Critical overdue (grace period limit) — threshold, not exact day, so
    // a single missed cron run still catches up on the next run instead of
    // silently skipping this stage forever. Idempotency is enforced
    // downstream by the per-(stage, agreement) delivery-log unique
    // constraint (whatsapp-template-delivery.ts), not by exact-day matching,
    // so matching on multiple consecutive days is safe — it still only ever
    // sends once.
    if (
      (states.includes("RENEWAL_OVERDUE_CRITICAL") || states.includes("RENEWAL_DECISION_PENDING")) &&
      daysOverdue >= decision.grace_period_days
    ) {
      return "30_DAY_CRITICAL";
    }

    // 2. 7 days overdue (threshold, checked after the grace-period critical
    // band above so the two don't double-match)
    if (
      (states.includes("RENEWAL_OVERDUE_CRITICAL") || states.includes("RENEWAL_DECISION_PENDING")) &&
      daysOverdue >= 7
    ) {
      return "7_DAY_OVERDUE";
    }

    // 3. Expiry day (0 days left) — intentionally kept as an exact match.
    // There's no meaningful catch-up for a single expiry-day alert once
    // it's passed (the tenant moves straight into the overdue bands above),
    // and broadening this into a multi-day band would collide with
    // EXPIRED_RENT_OVERDUE below (a rent-overdue *state* check, not a
    // day-count check).
    if (daysUntilExpiry === 0) {
      return "EXPIRY_DAY_ALERT";
    }

    // 4. 15 days left (threshold band: 1-15)
    if (daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 15) {
      return "15_DAY_REMINDER";
    }

    // 5. 30 days left (threshold band: 16-30)
    if (daysUntilExpiry !== null && daysUntilExpiry > 15 && daysUntilExpiry <= 30) {
      return "30_DAY_REMINDER";
    }

    // 6. Expired and rent overdue (lowest priority)
    if (states.includes("EXPIRED_AND_RENT_OVERDUE")) {
      return "EXPIRED_RENT_OVERDUE";
    }

    return null;
  }
}

export const renewalStatusService = new RenewalStatusService();
