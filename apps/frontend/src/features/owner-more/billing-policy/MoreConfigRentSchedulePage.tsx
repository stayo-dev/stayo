import { BillingPolicyForm } from './BillingPolicyForm';

/**
 * Rent — when it is raised, when it is due, and what happens when it is late.
 *
 * Late fees were their own row and their own screen, which split one question
 * across two places: an owner setting a grace period is already thinking about
 * what happens when it runs out, and the late-fee screen's own note had to
 * point back here to explain where grace was configured. They are one screen
 * now, in the order the month happens.
 */
export function MoreConfigRentSchedulePage() {
  return (
    <BillingPolicyForm
      sections={['schedule', 'lateFee']}
      title="Rent"
      subtitle="When rent is raised and due, and what happens when it is late"
    />
  );
}
