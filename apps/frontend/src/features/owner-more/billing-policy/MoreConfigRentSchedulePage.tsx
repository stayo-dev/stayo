import { BillingPolicyForm } from './BillingPolicyForm';

/** Finance › Rent schedule — generation day, due day, grace period. */
export function MoreConfigRentSchedulePage() {
  return (
    <BillingPolicyForm
      sections={['schedule']}
      title="Rent schedule"
      subtitle="When rent is raised, due, and counted late"
    />
  );
}
