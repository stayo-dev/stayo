import { BillingPolicyForm } from './BillingPolicyForm';

/** Finance › Part payments — whether a due can be cleared in instalments, and the floor. */
export function MoreConfigPartPaymentsPage() {
  return (
    <BillingPolicyForm
      sections={['collection']}
      title="Part payments"
      subtitle="Whether a due can be cleared in instalments"
    />
  );
}
