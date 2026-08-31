import { BillingPolicyForm } from './BillingPolicyForm';

/**
 * Rent — when it is raised, when it is due, and how long the grace period is,
 * drawn as a month so the three numbers can be seen rather than imagined.
 *
 * Late fees are their own screen. They were briefly combined with this one, on
 * the reasoning that grace and lateness are one question; separated again
 * because this screen is a calendar and that one is a pricing rule, and
 * stacking them made a single scroll carry two unrelated kinds of decision.
 */
export function MoreConfigRentSchedulePage() {
  return (
    <BillingPolicyForm
      sections={['schedule']}
      title="Rent"
      subtitle="When rent is raised and when it is due"
    />
  );
}
